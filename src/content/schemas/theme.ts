import { z } from "zod";

const AnimationFrameSchema = z.object({ image: z.string() });

const AnimationSchema = z.object({ duration: z.number(), frames: z.array(AnimationFrameSchema) });

const TowerVisualSchema = z.object({
  name: z.string(),
  color: z.string(),
  icon: z.string(),
  animation: AnimationSchema.nullable(),
  walking: AnimationSchema.optional(),
});

const EnemyVisualSchema = z.object({
  name: z.string(),
  color: z.string(),
  shape: z.string(),
  walking: AnimationSchema,
  hitReaction: AnimationSchema.nullable().optional(),
  attack: AnimationSchema.nullable().optional(),
});

const RegionVisualSchema = z.object({
  id: z.number(),
  name: z.string(),
  tiles: z.object({
    path: z.string(),
    terrain1: z.string(),
    terrain2: z.string(),
    terrain3: z.string(),
    terrain4: z.string(),
  }),
  base: z.string(),
});

const SpawnPointVisualSchema = z.object({ closed: z.string(), open: z.string(), transition: z.string() });

export const RawMapThemeSchema = z.object({
  id: z.string(),
  label: z.string(),
  towers: z.record(z.string(), TowerVisualSchema),
  enemies: z.record(z.string(), EnemyVisualSchema),
  regions: z.array(RegionVisualSchema),
  spawns: SpawnPointVisualSchema.optional(),
});

export type RawMapTheme = z.infer<typeof RawMapThemeSchema>;
