import economyRaw from "./data/economy.json";
import enemiesRaw from "./data/enemies.json";
import mapsRaw from "./data/maps.json";
import skillTreeRaw from "./data/skill-tree.json";
import towersRaw from "./data/towers.json";
import { type GameContent, GameContentSchema } from "./schemas/gameContent.js";

export function loadGameContent(): GameContent {
  const parsed = GameContentSchema.parse({
    towers: towersRaw,
    enemies: enemiesRaw,
    economy: economyRaw,
    maps: mapsRaw,
    skillTree: skillTreeRaw,
  });
  return Object.freeze(parsed) as GameContent;
}
