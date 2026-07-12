import { describe, expect, it } from "vitest";
import type { CommanderMemory } from "@/commanders/brain.js";
import type { CommanderObservation, ObservationEnemy, ObservationTower } from "@/commanders/observation.js";
import { createStubbsBrain } from "@/commanders/stubbs/brain.js";
import type { Command } from "@/sim/Command.js";
import { makeBastionMap } from "../../helpers/mock-grid.js";

// Build a commander gridLayout (0=terrain,1=path,2=base,3=spawn) from the bastion
// mock map: a single straight path row with the base at the right edge. Using the
// real map guarantees a connected path the brain's BFS distance can traverse.
const bastionMap = makeBastionMap();
const gridLayout: number[][] = bastionMap.tiles.map((row) =>
  row.map((tile) => (tile.type === "path" ? 1 : tile.type === "base" ? 2 : tile.type === "spawn" ? 3 : 0)),
);

function freshMemory(): CommanderMemory {
  return {
    phase: "idle",
    seenByWave: new Map<number, Set<number>>(),
    lastRushWaveNumber: null,
    lastRoutedTowerSignature: "",
    gridLayout: undefined,
  };
}

function enemy(id: number, tileX: number, tileY: number): ObservationEnemy {
  return { id, tileX, tileY, level: 1, hp: 10, maxHp: 10 };
}

function tower(tileX: number, tileY: number, hp: number, maxHp = hp, level = 1): ObservationTower {
  return { tileX, tileY, level, hp, maxHp };
}

function observation(opts: {
  currentWave?: number;
  enemies?: ObservationEnemy[];
  towers?: ObservationTower[];
}): CommanderObservation {
  return {
    map: gridLayout,
    enemies: opts.enemies ?? [],
    towers: opts.towers ?? [],
    wave: {
      currentWave: opts.currentWave ?? 1,
      pendingEnemyCount: 0,
      spawnStates: [],
      remainingScheduledSpawns: 0,
      active: true,
    },
  };
}

function routeGroupWaypoint(commands: Command[]) {
  const command = commands.find((c) => c.type === "llm:routeGroup");
  if (command?.type !== "llm:routeGroup") return null;
  return command.waypoints[0] ?? null;
}

describe("StubbsBrain", () => {
  it("routes newly-seen enemies immediately (no hold) toward the highest-hp ahead tower", () => {
    const brain = createStubbsBrain();
    const memory = freshMemory();
    const commands = brain.decide(
      observation({ enemies: [enemy(1, 1, 3)], towers: [tower(5, 3, 100), tower(3, 3, 60)] }),
      memory,
    );
    const hold = commands.find((c) => c.type === "llm:routeGroup" && c.hold === true);
    expect(hold).toBeUndefined();
    const waypoint = routeGroupWaypoint(commands);
    expect(waypoint).not.toBeNull();
    // Highest-hp ahead tower is (5,3); its nearest path tile is itself.
    expect(waypoint).toEqual({ x: 5, y: 3 });
  });

  it("excludes towers behind the group and keeps the behind tower untargeted", () => {
    const brain = createStubbsBrain();
    const memory = freshMemory();
    const commands = brain.decide(
      observation({ enemies: [enemy(1, 1, 3)], towers: [tower(5, 3, 100), tower(0, 3, 200)] }),
      memory,
    );
    const waypoint = routeGroupWaypoint(commands);
    expect(waypoint).toEqual({ x: 5, y: 3 });
  });

  it("emits no command when no live towers are ahead (default pathing)", () => {
    const brain = createStubbsBrain();
    const memory = freshMemory();
    // Only a tower behind the enemy (closer to spawn than the group).
    const commands = brain.decide(observation({ enemies: [enemy(1, 2, 3)], towers: [tower(0, 3, 200)] }), memory);
    expect(commands).toHaveLength(0);
  });

  it("does NOT re-route when only a tower's hp changes (stable signature)", () => {
    const brain = createStubbsBrain();
    const memory = freshMemory();
    brain.decide(observation({ enemies: [enemy(1, 1, 3)], towers: [tower(5, 3, 100), tower(3, 3, 60)] }), memory);
    // The highest-hp ahead tower (5,3) drops to 30 — signature uses level, not hp, so it is stable.
    const reroute = brain.decide(
      observation({ enemies: [enemy(1, 1, 3)], towers: [tower(5, 3, 30), tower(3, 3, 60)] }),
      memory,
    );
    expect(reroute).toHaveLength(0);
  });

  it("re-routes when a tower is upgraded (level change shifts the signature)", () => {
    const brain = createStubbsBrain();
    const memory = freshMemory();
    brain.decide(
      observation({ enemies: [enemy(1, 1, 3)], towers: [tower(5, 3, 100, 100, 1), tower(3, 3, 60, 60, 1)] }),
      memory,
    );
    // The (5,3) tower upgrades to level 2 — signature changes, forcing a re-route.
    const reroute = brain.decide(
      observation({ enemies: [enemy(1, 1, 3)], towers: [tower(5, 3, 100, 100, 2), tower(3, 3, 60, 60, 1)] }),
      memory,
    );
    const waypoint = routeGroupWaypoint(reroute);
    expect(waypoint).not.toBeNull();
    // Highest-hp ahead tower is still (5,3); its nearest path tile is itself.
    expect(waypoint).toEqual({ x: 5, y: 3 });
  });

  it("is idempotent per wave: a second identical observation emits nothing", () => {
    const brain = createStubbsBrain();
    const memory = freshMemory();
    brain.decide(observation({ enemies: [enemy(1, 1, 3)], towers: [tower(5, 3, 100)] }), memory);
    const second = brain.decide(observation({ enemies: [enemy(1, 1, 3)], towers: [tower(5, 3, 100)] }), memory);
    expect(second).toHaveLength(0);
  });

  it("resets across waves: a new wave's unseen enemy is routed", () => {
    const brain = createStubbsBrain();
    const memory = freshMemory();
    brain.decide(observation({ currentWave: 1, enemies: [enemy(1, 1, 3)], towers: [tower(5, 3, 100)] }), memory);
    const next = brain.decide(
      observation({ currentWave: 2, enemies: [enemy(2, 1, 3)], towers: [tower(5, 3, 100)] }),
      memory,
    );
    const waypoint = routeGroupWaypoint(next);
    expect(waypoint).toEqual({ x: 5, y: 3 });
  });
});
