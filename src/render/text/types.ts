export interface TextRenderScale {
  scaleX: number;
  scaleY: number;
}

// Minimal theme accessor surface the text managers need. The real Pinia
// `useMapThemeStore()` return value is structurally compatible.
export interface TextThemeAccess {
  getTowerVisual(type: string): { icon: string; color: string } | undefined;
  getEnemyVisual(type: string): { shape: string; color: string } | undefined;
  getEnemyGlyph(shape: string): string;
}
