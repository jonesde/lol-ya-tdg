import type { Command } from "@/sim/Command.js";
import type { CommanderBrain, CommanderMemory } from "../brain.js";
import type { CommanderObservation } from "../observation.js";
import { type ApiClient, type ChatMessage, createApiClient } from "./apiClient.js";
import { validateLlmResponse } from "./schema.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import type { LlmCommanderConfig } from "./types.js";

export interface LlmBrainCallbacks {
  onChat?: (text: string) => void;
  onNotify?: (message: string) => void;
  fetchFn?: typeof fetch;
}

const ESTIMATED_NEXT_PROMPT_TOKENS = 2048;

function serializeEnemies(observation: CommanderObservation): unknown[] {
  return observation.enemies.map((enemy) => ({
    id: enemy.id,
    x: enemy.tileX,
    y: enemy.tileY,
    level: enemy.level,
    hp: enemy.hp,
    maxHp: enemy.maxHp,
  }));
}

function serializeTowers(observation: CommanderObservation): unknown[] {
  return observation.towers.map((tower) => ({
    x: tower.tileX,
    y: tower.tileY,
    level: tower.level,
    hp: tower.hp,
    maxHp: tower.maxHp,
  }));
}

function waveSummary(observation: CommanderObservation): unknown {
  return {
    currentWave: observation.wave.currentWave,
    pendingEnemyCount: observation.wave.pendingEnemyCount,
    remainingScheduledSpawns: observation.wave.remainingScheduledSpawns,
    active: observation.wave.active,
  };
}

function buildFullSnapshotMessage(observation: CommanderObservation): string {
  return JSON.stringify({
    kind: "snapshot",
    map: observation.map,
    enemies: serializeEnemies(observation),
    towers: serializeTowers(observation),
    wave: waveSummary(observation),
  });
}

function towerKey(tower: { tileX: number; tileY: number }): string {
  return `${tower.tileX},${tower.tileY}`;
}

function buildDeltaMessage(observation: CommanderObservation, last: CommanderObservation): string {
  const lastEnemyById = new Map(last.enemies.map((enemy) => [enemy.id, enemy]));
  const newEnemies: unknown[] = [];
  const changedEnemies: unknown[] = [];
  for (const enemy of observation.enemies) {
    const previous = lastEnemyById.get(enemy.id);
    if (!previous) {
      newEnemies.push({
        id: enemy.id,
        x: enemy.tileX,
        y: enemy.tileY,
        level: enemy.level,
        hp: enemy.hp,
        maxHp: enemy.maxHp,
      });
    } else if (
      previous.tileX !== enemy.tileX ||
      previous.tileY !== enemy.tileY ||
      previous.hp !== enemy.hp ||
      previous.maxHp !== enemy.maxHp
    ) {
      changedEnemies.push({ id: enemy.id, x: enemy.tileX, y: enemy.tileY, hp: enemy.hp, maxHp: enemy.maxHp });
    }
  }

  const lastTowerByKey = new Map(last.towers.map((tower) => [towerKey(tower), tower]));
  const newTowers: unknown[] = [];
  const changedTowers: unknown[] = [];
  for (const tower of observation.towers) {
    const key = towerKey(tower);
    const previous = lastTowerByKey.get(key);
    if (!previous) {
      newTowers.push({ x: tower.tileX, y: tower.tileY, level: tower.level, hp: tower.hp, maxHp: tower.maxHp });
    } else if (previous.hp !== tower.hp || previous.maxHp !== tower.maxHp) {
      changedTowers.push({ x: tower.tileX, y: tower.tileY, hp: tower.hp, maxHp: tower.maxHp });
    }
  }

  return JSON.stringify({
    kind: "delta",
    newEnemies,
    changedEnemies,
    newTowers,
    changedTowers,
    wave: waveSummary(observation),
  });
}

// Creates the LLM commander brain. `decide` is async (it awaits the API client)
// and returns a Promise<Command[]>. The worker owns the in-flight guard + cadence,
// so this function only concerns itself with prompt assembly, calling the API,
// and translating the validated response into engine commands.
export function createLlmBrain(config: LlmCommanderConfig, callbacks: LlmBrainCallbacks = {}): CommanderBrain {
  const apiClient: ApiClient = createApiClient(callbacks.fetchFn ?? globalThis.fetch);

  function translateCommand(parsed: ReturnType<typeof validateLlmResponse>["commands"][number]): Command {
    if (parsed.type === "llm:routeGroup") {
      const routeGroupCommand: Command = {
        commandId: 0,
        type: "llm:routeGroup",
        enemyIds: parsed.enemyIds,
        hold: parsed.hold ?? false,
        waypoints: parsed.waypoints,
      };
      if (parsed.holdTile) routeGroupCommand.holdTile = parsed.holdTile;
      return routeGroupCommand;
    }
    return { commandId: 0, type: "llm:setTargeting", enemyIds: parsed.enemyIds, mode: parsed.mode };
  }

  return {
    async decide(observation: CommanderObservation, memory: CommanderMemory): Promise<Command[]> {
      const messages: ChatMessage[] = [];
      const rebuildFull = memory.conversation.length === 0 || memory.isCompressing;

      if (rebuildFull) {
        const instructions = memory.commanderInstructions || config.commanderInstructions;
        const systemPrompt = buildSystemPrompt(config, instructions);
        memory.conversation = [{ role: "system", content: systemPrompt }];
        memory.isCompressing = false;
        memory.lastObservation = null;
        const snapshotText = buildFullSnapshotMessage(observation);
        memory.conversation.push({ role: "user", content: snapshotText });
        messages.push({ role: "user", content: snapshotText });
      } else {
        const deltaText = buildDeltaMessage(observation, memory.lastObservation ?? observation);
        memory.conversation.push({ role: "user", content: deltaText });
        messages.push({ role: "user", content: deltaText });
      }

      for (const pendingMessage of memory.pendingPlayerMessages) {
        memory.conversation.push({ role: "user", content: pendingMessage });
        messages.push({ role: "user", content: pendingMessage });
      }
      memory.pendingPlayerMessages = [];

      const systemPrompt = memory.conversation[0]?.content ?? buildSystemPrompt(config, memory.commanderInstructions);
      const result = await apiClient.complete(systemPrompt, messages, config);

      if ("empty" in result || "error" in result) {
        if ("error" in result) {
          callbacks.onNotify?.(`LLM request failed: ${result.error}`);
        }
        return [];
      }

      memory.tokenCount = result.promptTokens;
      if (memory.tokenCount + ESTIMATED_NEXT_PROMPT_TOKENS >= config.contextLimit) {
        memory.isCompressing = true;
        memory.lastObservation = null;
      }

      let parsedRaw: unknown;
      try {
        parsedRaw = JSON.parse(result.content);
      } catch {
        callbacks.onNotify?.("LLM response was not valid JSON");
        return [];
      }

      const parsed = validateLlmResponse(parsedRaw, config);
      if (parsed.error) {
        callbacks.onNotify?.(`LLM response rejected: ${parsed.error}`);
        return [];
      }

      const commands: Command[] = parsed.commands.map(translateCommand);
      if (parsed.chat) callbacks.onChat?.(parsed.chat);
      if (!memory.isCompressing) memory.lastObservation = observation;
      return commands;
    },
  };
}
