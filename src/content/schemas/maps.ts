import { z } from "zod";

export const MapStyleSchema = z.enum(["open", "canyon", "serpentine", "split", "bastion", "battlefield"]);

export const MapLevelConfigSchema = z.object({
  width: z.number(),
  height: z.number(),
  regionId: z.number(),
  level: z.number(),
  style: MapStyleSchema,
  seed: z.number(),
});

export const MapsContentSchema = z.object({
  mapBaseSize: z.number(),
  mapSizeScale: z.number(),
  maxMapDim: z.number(),
  heightNoiseFreq: z.number(),
  heightNoiseDivisor: z.number(),
  serpentineStep: z.number(),
  serpentineDownCap: z.number(),
  mapsPerRegion: z.number(),
  levels: z.array(MapLevelConfigSchema).length(36),
});

export type MapsContent = z.infer<typeof MapsContentSchema>;
export type MapLevelConfigData = z.infer<typeof MapLevelConfigSchema>;
export type MapStyleData = z.infer<typeof MapStyleSchema>;
