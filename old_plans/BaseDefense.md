Base Health System + Base Surround Behavior — Validated Plan
Validated assumptions (verified by reading source)
- Grid base is a single Point tile (Grid.base, from Map.ts). The "3×3" is only SVG art over the base tile. getBaseTiles() must derive the surrounding ring (8 tiles orthogonally/diagonally adjacent to the base center), not read type==="base" tiles (there's only one).
- STARTING_HEALTH_BONUS = [10,20,50] → total 80 currently; plan's [100,300,500] → 900 (plus STARTING_BASE_HEALTH=100 → base 1000 when all unlocked). Matches.
- WaveGraphDot already has baseHealth + baseHealthColor fields, and UiOverlayManager already has pooled rect/bar drawing (syncFromGameEngine HP/shield bars are the template). So Phase 4 reuses existing patterns.
- Tower.takeDamage(amount, attacker?) (Tower.ts:709) is the target interface the base must mirror.
- Commander release does NOT reference reachedBase (grep clean) — release uses llm:routeGroup/releaseToDefault on routingMode. So the attackingBase rename does not touch commander code.
Decisions confirmed with user
1. Surround = simpler first-perimeter. No baseTileClaims map, no BFS-over-perimeter-for-free-tile. Multi-goal BFS terminates at the nearest perimeter tile; the enemy parks there and attacks; existing resolveCollisions lane-offset separation provides visual spacing.
2. Slow-heal clamps to maxBaseHealth (not the old startingLives).
Phase 0 — Constants & skill-tree text
- Constants.ts: STARTING_HEALTH_BONUS → [100,300,500]; SLOW_HEALING_PER_ROUND → [20,50,100]; add STARTING_BASE_HEALTH = 100. (The WAVE_GRAPH_COLOR_BASE_HEALTH_* constants already exist — reuse.)
- SkillTree.ts:300-333: extraHealth tier labels +10/+20/+50 → +100/+300/+500, desc "…lives" → "…health"; slowHealing tier labels +1/+2/+4 per wave → +20/+50/+100 per wave, desc updated. Gem costs unchanged.
Phase 1 — Rename lives → baseHealth/maxBaseHealth
Spine files (all confirmed to reference lives/loseLives/startingLives/reachedBase):
- GameRunState.ts: lives→baseHealth + add maxBaseHealth; initRunState 20→STARTING_BASE_HEALTH (import it); rename loseLives→damageBase(amount) (just state.baseHealth -= amount).
- GameEngine.ts: constructor startingLives=20→ keep as maxBaseHealth = STARTING_BASE_HEALTH; _initMap literal lives:20→baseHealth: STARTING_BASE_HEALTH, maxBaseHealth: STARTING_BASE_HEALTH; _applyStartingBonuses adds to baseHealth then sets this.maxBaseHealth = this.runState.baseHealth (was startingLives); onWaveStart slow-heal clamps to this.maxBaseHealth (was startingLives), and SLOW_HEALING_PER_ROUND values now 20/50/100; debug addLives→addBaseHealth clamped 0..maxBaseHealth; shouldEndGame now keyed on baseHealth<=0 (already the case, just the field rename). Remove/repurpose startingLives field.
- SnapshotSerializer.ts:103 + SnapshotMeta (SimulationSnapshot.ts:75): lives→baseHealth + add maxBaseHealth.
- SnapshotStore.ts:169: mirror gs.baseHealth/gs.maxBaseHealth (rename, add). Keep gameStore.lives compat? No — rename fully per plan.
- stores/game.ts: lives→baseHealth+maxBaseHealth in interface (GameStateShape:79), initMap:214, resetToMenu:281, loseLives→damageBase, and getters/tests.
- Command.ts:9: addLives→addBaseHealth; applyCommand.ts:73-75 passes through unchanged.
- DebugPanel.vue:62-64,102: rename dbgLives→dbgBaseHealth, kind addBaseHealth, relabel button "❤️ +100 Health" (clamped to max).
- GameHud.vue:89-92: label "Health", bind gameStore.baseHealth, thresholds by ratio baseHealth/maxBaseHealth (<=0.25 critical, <=0.5 warning).
- StatsPanel.vue:71-72,158: use baseHealth/maxBaseHealth for "Health Lost".
- WaveGraphTracker.ts: replace _intervalMinLives/hardcoded _computeBaseHealthColor thresholds (11/6) with percentage vs maxBaseHealth (>0.5 green / >0.25 yellow / <=0.25 red), reading runState.maxBaseHealth. Dot baseHealth = this.runState.baseHealth.
- WaveGraph.vue: already reads dot.baseHealth/dot.baseHealthColor — no change needed.
Phase 2 — Enemies attack the base like a tower
- BaseTarget (new, in GameEngine.ts): a small object implementing the AttackTarget interface (define interface AttackTarget { takeDamage(amount:number, attacker?:Enemy):void; isGhost:boolean; centerX:number; centerY:number; health:number } in Enemy.ts, export it). BaseTarget:
- centerX/centerY = grid.tileToWorld(grid.getBase())
- isGhost = false
- takeDamage(amount) → engine.damageBase(amount) (which does runState.baseHealth -= amount; if(<=0) shouldEndGame=true; host.playSound("base_hit"))
- health getter → engine.runState.baseHealth
- Wiring: EnemyManager gains baseTarget: AttackTarget | null, set by GameEngine._initMap after grid is built. EnemyManager.spawn passes it into new Enemy(...), stored as enemy.baseTarget.
- Enemy.update (around 529-547): in the default-mode end-of-path branch, replace this.reachedBase = true; return; with:
this.attackingBase = true;
// fall through; attack resolution below targets the base
Add attackingBase = false to constructor, and a baseTarget: AttackTarget | null = null field.
- In the attack-resolution block (571-600): after computing liveForwardTower, add: if this.attackingBase && this.baseTarget, set attackTarget = this.baseTarget. In the movement block (603-636): add an else if (this.attackingBase) branch that steps centerX/centerY toward the base center (tileToWorld(grid.getBase())) by the normal step, stopping at contactDistance = tileSize/2 + radius (so enemies cluster at the base edge on the perimeter tile they arrived on). The attack tick (645-652) already calls attackTarget.takeDamage(this.attackDamage, this) on cooldown 1/(attackSpeed*slowFactor) — now hits the base. Do not set reachedBase/removed.
- GameEngine.update callback (325-348): remove the loseLives+removed=true+boss-special-damage logic. New callback:
this.enemyManager.update(dt, (enemy) => {
  if (enemy.removed) {
    if (enemy.type === "boss") this.onBossKilled();
    this.onEnemyKill(enemy);
  }
  // base-attacking enemies are never removed here; their damage flows via baseTarget.takeDamage
});
Keep waveManager.baseReached = true set when any enemy begins attacking (set inside Enemy on first attackingBase flip, or via a manager flag) — WaveGraphTracker/stats may read it; grepping shows baseReached is set but only consumed in WaveManager itself, so a lightweight flag is fine. Boss no longer special-damages (its higher attackDamage already hits harder). shouldEndGame stays driven by baseHealth<=0.
- EnemyManager.update (144-170): only remove when enemy.removed (drop the || enemy.reachedBase branches at 152/161). forEachEnemyInRange/getEnemiesInRange already skip reachedBase — change to skip only removed so attacking-base enemies still participate in collision separation (desired for surround spacing).
Phase 3 — Surround the base (simpler first-perimeter, per decision)
- Grid.ts: add getBaseTiles(): Point[] returning the 3×3 ring derived from this.base (center + 8 neighbors, filtered inBounds), and a getBasePerimeterTiles(): Point[] returning the 8 neighbors only (the valid attack tiles).
- Pathfinding.ts: bfsShortestPath and dijkstraWeakestPath accept a multi-tile goal (Point[]), terminating when any goal tile is reached; reconstruct as before. Update all callers in Grid.ts (recomputePaths, recomputePathsForTile, computeRoute) to pass [this.base, ...perimeterTiles] as the goal (center + ring), and bfsReverseFromBase to seed from the base tile (unchanged) — all 9 base tiles are goals so spawn→base paths remain valid (satisfies map.test.ts risk). Weakest-tower fallback preserved.
- Enemies naturally end their path at the nearest perimeter tile (multi-goal BFS) and, once attackingBase, attack the base center (Phase 2 movement). Lateral spread comes from existing resolveCollisions. No claim map.
Phase 4 — Base Health overlay bar
- UiOverlayManager.ts: add a dedicated bar pool (≈108×8–10) in init() + dirty-check caches; new method syncBaseHealthBar(grid, baseHealth, maxBaseHealth) positioned at grid.tileToWorld(grid.getBase()) (centered, offset above the art), ratio-colored via WAVE_GRAPH_COLOR_BASE_HEALTH_GREEN/YELLOW/RED. dispose() must remove these too.
- SvgGameRoot.vue:401-403 (render loop, where gameStore.grid is used): call uiOverlayManager.syncBaseHealthBar(gameStore.grid, snapshot.meta.baseHealth, snapshot.meta.maxBaseHealth) after the existing overlay syncs.
Phase 5 — Tests & verification
Rename lives→baseHealth/maxBaseHealth in fixtures/assertions: tests/unit/game-store.test.ts (lines 30,70-73,164-172,254-256,273-278,390-407), tests/integration/integration.test.ts (71-75,216), tests/integration/commander.test.ts (114-120), tests/unit/commanders/observation.test.ts (20,32), tests/unit/components/game-hud.test.ts (46), tests/unit/components/stats-panel.test.ts (59,84,96), tests/unit/components/text-game-root.test.ts, tests/unit/sim/snapshot.test.ts, tests/unit/snapshot-store.test.ts, tests/helpers/mock-stores.ts (165). Update any =20 base assumption to the STARTING_BASE_HEALTH (100) model; boss/gem =20+STARTING_HEALTH_BONUS[…] assertions → 100+….
reachedBase consumers to switch to attackingBase: tests/unit/enemy-manager.test.ts (122,201), tests/unit/enemies.test.ts (127,315,317,348) — these assert the one-shot; rewrite to assert the enemy transitions to attackingBase and keeps attacking (not removed) instead of reachedBase/removed.
New tests/unit/enemy-attack.test.ts: enemy at path end sets attackingBase, damages baseHealth on cooldown, does not despawn; boss deals more (higher attackDamage); baseHealth<=0 ⇒ game over.
skill-tree.test.ts: tier-indexed; assert new label values +100/+300/+500 and +20/+50/+100 and unchanged gem costs.
Run npm run lint && npm run typecheck && npm test.
Risks / notes
- maxBaseHealth must be threaded into WaveGraphTracker (read runState.maxBaseHealth) and the snapshot meta for GameHud/StatsPanel/SvgGameRoot ratios.
- Towers still kill base-attacking enemies via unchanged enemy.hp/removed — no change needed (verified: attack target uses enemy.x/y/hp, untouched).
- End-game source changes to baseHealth<=0 (gem calc in endGame untouched).
- Biggest churn: the reachedBase→attackingBase rename across tests and the baseHealth=100 fixture updates.
- Surround fidelity is intentionally approximate (per your decision): enemies may share a perimeter tile; collision separation spreads them visually but they all damage the base.
