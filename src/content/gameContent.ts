import { loadGameContent } from "./loadGameContent.js";
import type { GameContent } from "./schemas/gameContent.js";

let cached: GameContent | null = null;

export function getGameContent(): GameContent {
  if (!cached) {
    cached = loadGameContent();
  }
  return cached;
}

// Test-only override; production code must not call this.
export function setGameContentForTests(content: GameContent | null): void {
  cached = content;
}
