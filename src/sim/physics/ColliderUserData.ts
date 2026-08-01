// Tags attached to Rapier rigid bodies via userData so contact/event drains can
// resolve a collider back to a gameplay entity without scanning all managers.

export type ColliderTag =
  | { kind: "base" }
  | { kind: "tower"; towerId: string; tileX: number; tileY: number }
  | { kind: "enemy"; enemyId: number }
  | { kind: "projectile"; projectileId: number }
  | { kind: "corridor" }
  | { kind: "sensor"; sensorId: string; ownerId?: string };

export function isColliderTag(value: unknown): value is ColliderTag {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === "base" ||
    kind === "tower" ||
    kind === "enemy" ||
    kind === "projectile" ||
    kind === "corridor" ||
    kind === "sensor"
  );
}
