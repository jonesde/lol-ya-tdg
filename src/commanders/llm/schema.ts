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

export type ParsedLlmCommand = ParsedRouteGroup | ParsedSetTargeting;

export interface LlmResponseResult {
  commands: ParsedLlmCommand[];
  chat?: string | undefined;
  error?: string | undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function asTileCoordinate(value: unknown): TileCoordinate | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!isFiniteNumber(candidate.x) || !isFiniteNumber(candidate.y)) return null;
  return { x: candidate.x, y: candidate.y };
}

function parseEnemyIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const result: number[] = [];
  for (const entry of raw) {
    if (isFiniteNumber(entry)) result.push(entry);
  }
  return result;
}

function parseWaypoints(raw: unknown): TileCoordinate[] {
  if (!Array.isArray(raw)) return [];
  const result: TileCoordinate[] = [];
  for (const entry of raw) {
    const tile = asTileCoordinate(entry);
    if (tile) result.push(tile);
  }
  return result;
}

// Validates an LLM response into a strict command list. Accepts either a bare
// array of command objects or an object wrapping `{ commands?, chat? }`. Only
// `llm:routeGroup` and `llm:setTargeting` are permitted; anything else is
// dropped and recorded in `error`. `error` is set only for whole-response
// structural failures, so salvageable commands still execute.
export function validateLlmResponse(raw: unknown, _config: LlmCommanderConfig): LlmResponseResult {
  const commands: ParsedLlmCommand[] = [];
  let chat: string | undefined;
  let error: string | undefined;

  let commandArray: unknown;
  if (Array.isArray(raw)) {
    commandArray = raw;
  } else if (raw && typeof raw === "object") {
    const object = raw as Record<string, unknown>;
    commandArray = object.commands;
    if (typeof object.chat === "string" && object.chat.length > 0) chat = object.chat;
  } else {
    return { commands: [], error: "unrecognized response shape" };
  }

  if (!Array.isArray(commandArray)) {
    return { commands: [], error: "commands field is not an array" };
  }

  for (const entry of commandArray) {
    if (!entry || typeof entry !== "object") {
      error = error ?? "invalid command entry";
      continue;
    }
    const command = entry as Record<string, unknown>;
    const type = command.type;
    if (type !== "llm:routeGroup" && type !== "llm:setTargeting") {
      error = error ?? `rejected command type: ${String(type)}`;
      continue;
    }

    const enemyIds = parseEnemyIds(command.enemyIds);
    if (enemyIds.length === 0) continue;

    if (type === "llm:routeGroup") {
      const parsedHoldTile = asTileCoordinate(command.holdTile);
      const routeGroup: ParsedRouteGroup = {
        type: "llm:routeGroup",
        enemyIds,
        waypoints: parseWaypoints(command.waypoints),
      };
      if (typeof command.hold === "boolean") routeGroup.hold = command.hold;
      if (parsedHoldTile) routeGroup.holdTile = parsedHoldTile;
      commands.push(routeGroup);
    } else {
      const mode = typeof command.mode === "string" ? command.mode : "";
      if (!mode) {
        error = error ?? "setTargeting missing mode";
        continue;
      }
      commands.push({ type: "llm:setTargeting", enemyIds, mode });
    }
  }

  return { commands, chat, error };
}
