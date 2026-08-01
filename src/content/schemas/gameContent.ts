import { z } from "zod";
import { EconomyContentSchema } from "./economy.js";
import { EnemiesContentSchema } from "./enemies.js";
import { MapsContentSchema } from "./maps.js";
import { SkillTreeContentSchema } from "./skillTree.js";
import { TowersContentSchema } from "./towers.js";

export const GameContentSchema = z.object({
  towers: TowersContentSchema,
  enemies: EnemiesContentSchema,
  economy: EconomyContentSchema,
  maps: MapsContentSchema,
  skillTree: SkillTreeContentSchema,
});

export type GameContent = z.infer<typeof GameContentSchema>;
