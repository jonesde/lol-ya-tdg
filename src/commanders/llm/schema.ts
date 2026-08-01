import { LlmCommandSchema, LlmResponseBodySchema } from "@/content/schemas/llmResponse.js";
import type { LlmCommanderConfig } from "./types.js";

interface TileCoordinate {
  x: number;
  y: number;
}

export interface ParsedRouteGroup {
  type: "llm:routeGroup";
  enemyIds: number[];
  hold?: boolean;
  holdTile?: TileCoordinate;
  waypoints: TileCoordinate[];
}

export interface ParsedSetTargeting {
  type: "llm:setTargeting";
  enemyIds: number[];
  mode: string;
}

export interface ParsedSiegeTower {
  type: "llm:siegeTower";
  enemyIds: number[];
  towerTile: TileCoordinate;
}

export type ParsedLlmCommand = ParsedRouteGroup | ParsedSetTargeting | ParsedSiegeTower;

export interface LlmResponseResult {
  commands: ParsedLlmCommand[];
  chat?: string | undefined;
  error?: string | undefined;
}

// Validates an LLM response into a strict command list. Accepts either a bare
// array of command objects or an object wrapping `{ commands?, chat? }`. Only
// `llm:routeGroup`, `llm:siegeTower`, and `llm:setTargeting` are permitted.
// Soft-reject: bad entries are dropped with an error string; valid siblings keep.
export function validateLlmResponse(raw: unknown, _config: LlmCommanderConfig): LlmResponseResult {
  const bodyResult = LlmResponseBodySchema.safeParse(raw);
  if (!bodyResult.success) {
    return { commands: [], error: "unrecognized response shape" };
  }

  const body = bodyResult.data;
  let commandArray: unknown[];
  let chat: string | undefined;

  if (Array.isArray(body)) {
    commandArray = body;
  } else {
    if (!Array.isArray(body.commands)) {
      return { commands: [], error: "commands field is not an array" };
    }
    commandArray = body.commands;
    if (typeof body.chat === "string" && body.chat.length > 0) chat = body.chat;
  }

  const commands: ParsedLlmCommand[] = [];
  let error: string | undefined;

  for (const entry of commandArray) {
    if (!entry || typeof entry !== "object") {
      error = error ?? "invalid command entry";
      continue;
    }

    const type = (entry as Record<string, unknown>).type;
    if (type !== "llm:routeGroup" && type !== "llm:setTargeting" && type !== "llm:siegeTower") {
      error = error ?? `rejected command type: ${String(type)}`;
      continue;
    }

    const parsed = LlmCommandSchema.safeParse(entry);
    if (!parsed.success) {
      if (type === "llm:siegeTower") {
        error = error ?? "siegeTower missing towerTile";
      } else if (type === "llm:setTargeting") {
        error = error ?? "setTargeting missing mode";
      }
      continue;
    }

    const command = parsed.data;
    if (command.enemyIds.length === 0) continue;

    if (command.type === "llm:routeGroup") {
      const routeGroup: ParsedRouteGroup = {
        type: "llm:routeGroup",
        enemyIds: command.enemyIds,
        waypoints: command.waypoints ?? [],
      };
      if (command.hold !== undefined) routeGroup.hold = command.hold;
      if (command.holdTile) routeGroup.holdTile = command.holdTile;
      commands.push(routeGroup);
    } else if (command.type === "llm:siegeTower") {
      commands.push({ type: "llm:siegeTower", enemyIds: command.enemyIds, towerTile: command.towerTile });
    } else {
      commands.push({ type: "llm:setTargeting", enemyIds: command.enemyIds, mode: command.mode });
    }
  }

  return { commands, chat, error };
}
