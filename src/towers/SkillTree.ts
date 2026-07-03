import { GENERAL_ADDON_GEM_COSTS, SELL_OPTION_GEM_COST } from "../game/Constants.js";
import { TOWER_META, TowerIds } from "../game/ConstantsTower.js";

const LEVEL_COSTS = [0, 0, 16, 32, 64, 128, 256];
const ADDON_COSTS = [100, 300, 900];

interface UnlockState {
  levels: boolean[];
  variantA: boolean[];
  variantB: boolean[];
  addons: boolean[];
}

interface SaveData {
  gems: number;
  unlocked: Record<string, UnlockState>;
  generalAddons?: Record<string, unknown>;
}

interface SkillNode {
  tier: string;
  index: number;
  label: string;
  cost: number;
  desc: string;
}

interface TowerSkillTree {
  name: string;
  color: string;
  icon: string;
  levels: SkillNode[];
  variantA: SkillNode[];
  variantB: SkillNode[];
  addons: SkillNode[];
}

interface GeneralAddonDef {
  key: string;
  label: string;
  desc: string;
  tiers: { label: string; desc: string }[];
  costs: readonly number[];
  isSellOption?: boolean;
}

interface GeneralAddonCategory {
  label: string;
  addons: string[];
}

export const SKILL_TREE: Record<string, TowerSkillTree> = {};

export const VARIANT_INFO: Record<string, { A: { name: string; desc: string }; B: { name: string; desc: string } }> = {
  basic: {
    A: { name: "Rapid Fire", desc: "Fires 3× faster with reduced damage per shot." },
    B: { name: "Heavy Shot", desc: "Fires slower but each round deals 2.5× damage." },
  },
  ice: {
    A: { name: "Permafrost", desc: "Shots deal frost AoE damage in a growing radius around each hit." },
    B: { name: "Shatter", desc: "Doubles frost damage and cracks enemy armor." },
  },
  sniper: {
    A: { name: "Marksman", desc: "20% chance to instantly eliminate non-boss enemies." },
    B: { name: "Piercer", desc: "Bullets pierce through 3 enemies in a line." },
  },
  cannon: {
    A: { name: "Fragmentation", desc: "Increases splash radius by 40% per tier." },
    B: { name: "Napalm", desc: "Shots leave a burning patch that damages over time." },
  },
  lightning: {
    A: { name: "Overload", desc: "Adds 2 chain targets per tier with +20% damage." },
    B: { name: "Stormcall", desc: "Strikes random enemies in a wide area." },
  },
  railgun: {
    A: { name: "Knockback", desc: "Physically pushes enemies back along the path." },
    B: { name: "Rail Lance", desc: "Removes pierce falloff for consistent damage." },
  },
};

const ADDON_INFO: Record<string, { name: string; desc: string }[]> = {
  basic: [
    { name: "Critical Hit", desc: "15% chance for a ×2 damage critical hit." },
    { name: "Gold Rush", desc: "Each critical hit grants +1 bonus gold." },
    { name: "Bounce Shot", desc: "Bullets bounce to 1 nearby enemy on hit." },
  ],
  ice: [
    { name: "Frost Aura", desc: "Permanent slow aura on adjacent path tiles." },
    { name: "Deep Freeze", desc: "Increases slow strength by 25%." },
    { name: "Ice Burst", desc: "Periodic freeze burst stuns nearby enemies." },
  ],
  sniper: [
    { name: "True Shot", desc: "20% chance to instant-kill non-boss enemies." },
    { name: "Mark Target", desc: "Revealed target takes +25% damage from all sources." },
    { name: "Long Range", desc: "Grants +2 additional range." },
  ],
  cannon: [
    { name: "Wide Blast", desc: "Increases splash radius by 50%." },
    { name: "Stun Shell", desc: "Splash damage applies a 0.3s stun effect." },
    { name: "Anti-Air", desc: "Shots hit air units and ignore enemy shields." },
  ],
  lightning: [
    { name: "Static Field", desc: "Tower emits a field that slows nearby enemies by 15%." },
    { name: "Double Discharge", desc: "10% chance to fire a second bolt instantly." },
    { name: "Burn Circuit", desc: "Chained enemies take +20% damage for 2 seconds." },
  ],
  railgun: [
    { name: "Charge Shot", desc: "Every 5th shot deals ×3 damage." },
    { name: "Anti-Heal", desc: "Shots disable enemy healer auras for 2 seconds." },
    { name: "Multi-Pierce", desc: "Beams pierce 2 additional enemies." },
  ],
};

for (const id of Object.values(TowerIds)) {
  const variantA = VARIANT_INFO[id]!.A;
  const variantB = VARIANT_INFO[id]!.B;
  const addonDefs = ADDON_INFO[id]!;
  SKILL_TREE[id] = {
    name: TOWER_META[id]!.name,
    color: TOWER_META[id]!.color,
    icon: TOWER_META[id]!.icon,
    levels: [
      { tier: "level", index: 2, label: "Level 3", cost: LEVEL_COSTS[2]!, desc: "Unlock upgrade to level 3." },
      { tier: "level", index: 3, label: "Level 4", cost: LEVEL_COSTS[3]!, desc: "Unlock upgrade to level 4." },
    ],
    variantA: [
      { tier: "variantA", index: 0, label: `${variantA.name} 1`, cost: LEVEL_COSTS[4]!, desc: variantA.desc },
      {
        tier: "variantA",
        index: 1,
        label: `${variantA.name} 2`,
        cost: LEVEL_COSTS[5]!,
        desc: `${variantA.name} 2 upgrade (level 6).`,
      },
      {
        tier: "variantA",
        index: 2,
        label: `${variantA.name} 3`,
        cost: LEVEL_COSTS[6]!,
        desc: `${variantA.name} 3 final mastery (level 7).`,
      },
    ],
    variantB: [
      { tier: "variantB", index: 0, label: `${variantB.name} 1`, cost: LEVEL_COSTS[4]!, desc: variantB.desc },
      {
        tier: "variantB",
        index: 1,
        label: `${variantB.name} 2`,
        cost: LEVEL_COSTS[5]!,
        desc: `${variantB.name} 2 upgrade (level 6).`,
      },
      {
        tier: "variantB",
        index: 2,
        label: `${variantB.name} 3`,
        cost: LEVEL_COSTS[6]!,
        desc: `${variantB.name} 3 final mastery (level 7).`,
      },
    ],
    addons: [
      { tier: "addons", index: 0, label: addonDefs[0]!.name, cost: ADDON_COSTS[0]!, desc: addonDefs[0]!.desc },
      { tier: "addons", index: 1, label: addonDefs[1]!.name, cost: ADDON_COSTS[1]!, desc: addonDefs[1]!.desc },
      { tier: "addons", index: 2, label: addonDefs[2]!.name, cost: ADDON_COSTS[2]!, desc: addonDefs[2]!.desc },
    ],
  };
}

function getCost(tier: string, index: number): number {
  if (tier === "level") return LEVEL_COSTS[index] || 0;
  if (tier === "variantA" || tier === "variantB") return LEVEL_COSTS[index + 4] || 0;
  if (tier === "addons") return ADDON_COSTS[index] || 0;
  return 0;
}

export function isUnlocked(save: SaveData, towerId: string, tier: string, index: number): boolean {
  const unlocked = save.unlocked[towerId];
  if (!unlocked) return false;
  if (tier === "level") return !!unlocked.levels[index];
  if (tier === "variantA") return !!unlocked.variantA[index];
  if (tier === "variantB") return !!unlocked.variantB[index];
  if (tier === "addons") return !!unlocked.addons[index];
  return false;
}

export function isAvailable(save: SaveData, towerId: string, tier: string, index: number, cost: number): boolean {
  if (isUnlocked(save, towerId, tier, index)) return true;
  if (save.gems < cost) return false;
  const unlocked = save.unlocked[towerId]!;
  if (tier === "level" && index >= 3 && !unlocked.levels[index - 1]) return false;
  if (tier === "variantA" && index > 0 && !unlocked.variantA[index - 1]) return false;
  if (tier === "variantB" && index > 0 && !unlocked.variantB[index - 1]) return false;
  if ((tier === "variantA" || tier === "variantB") && index === 0 && !unlocked.levels[3]) return false;
  return true;
}

export function unlockCost(tier: string, index: number): number {
  return getCost(tier, index);
}

export function canRefund(save: SaveData, towerId: string, tier: string, index: number): number {
  if (!isUnlocked(save, towerId, tier, index)) return 0;
  const unlocked = save.unlocked[towerId]!;

  if (tier === "level") {
    if (index === 2 && unlocked.levels[3]) return 0;
    if (index === 3) {
      if (
        unlocked.variantA[0] ||
        unlocked.variantA[1] ||
        unlocked.variantA[2] ||
        unlocked.variantB[0] ||
        unlocked.variantB[1] ||
        unlocked.variantB[2]
      )
        return 0;
    }
  }
  if (tier === "variantA") {
    if (index === 0 && unlocked.variantA[1]) return 0;
    if (index === 1 && unlocked.variantA[2]) return 0;
  }
  if (tier === "variantB") {
    if (index === 0 && unlocked.variantB[1]) return 0;
    if (index === 1 && unlocked.variantB[2]) return 0;
  }
  if (tier === "addons") {
    if (index === 0 && unlocked.addons[1]) return 0;
    if (index === 1 && unlocked.addons[2]) return 0;
  }

  return getCost(tier, index);
}

export function tryRefund(save: SaveData, towerId: string, tier: string, index: number) {
  const refundAmount = canRefund(save, towerId, tier, index);
  if (refundAmount === 0) return { ok: false, reason: "Cannot refund: dependent unlocks active" };
  const unlocked = save.unlocked[towerId]!;
  const key =
    tier === "addons" ? "addons" : tier === "variantA" ? "variantA" : tier === "variantB" ? "variantB" : "levels";
  unlocked[key][index] = false;
  save.gems += refundAmount;
  return { ok: true, gems: refundAmount };
}

export function tryUnlock(save: SaveData, towerId: string, tier: string, index: number) {
  if (isUnlocked(save, towerId, tier, index)) return { ok: false, reason: "Already unlocked" };
  const cost = getCost(tier, index);
  if (save.gems < cost) return { ok: false, reason: "Not enough gems" };

  const unlocked = save.unlocked[towerId];
  if (!unlocked) return { ok: false, reason: "Tower not found" };
  if (!unlocked.levels || !unlocked.variantA || !unlocked.variantB) return { ok: false, reason: "Invalid save data" };
  if (tier === "level" && index >= 3 && !unlocked.levels[index - 1])
    return { ok: false, reason: "Unlock previous level first" };
  if (tier === "variantA" && index > 0 && !unlocked.variantA[index - 1])
    return { ok: false, reason: "Unlock previous tier first" };
  if (tier === "variantB" && index > 0 && !unlocked.variantB[index - 1])
    return { ok: false, reason: "Unlock previous tier first" };
  if ((tier === "variantA" || tier === "variantB") && index === 0 && !unlocked.levels[3])
    return { ok: false, reason: "Unlock level 4 first" };

  save.gems -= cost;
  if (tier === "level") unlocked.levels[index] = true;
  else if (tier === "variantA") unlocked.variantA[index] = true;
  else if (tier === "variantB") unlocked.variantB[index] = true;
  else if (tier === "addons") unlocked.addons[index] = true;
  return { ok: true };
}

export function maxLevelFor(save: SaveData, towerId: string, variant: "A" | "B" | null): number {
  const unlocked = save.unlocked[towerId]!;
  let max = 2;
  if (unlocked.levels[2]) max = 3;
  if (unlocked.levels[3]) max = 4;
  if (variant === "A" || variant === "B") {
    const arr = variant === "A" ? unlocked.variantA : unlocked.variantB;
    let extra = 0;
    for (let i = 0; i < 3; i++)
      if (arr[i]) extra++;
      else break;
    max = 4 + extra;
  }
  return max;
}

export const GENERAL_ADDON_CATEGORIES: Record<string, GeneralAddonCategory> = {
  economy: { label: "Economy", addons: ["startingGold", "sellOption", "upgradeCostReduction"] },
  health: { label: "Health", addons: ["extraHealth", "slowHealing"] },
  damage: { label: "Damage", addons: ["terrainHeightBonus", "terrainHeightRangeBonus", "damageMilestoneBonus"] },
};

export const GENERAL_ADDON_DEFS: Record<string, GeneralAddonDef> = {
  extraHealth: {
    key: "extraHealth",
    label: "Extra Health",
    desc: "Gain bonus lives at the start of each run.",
    tiers: [
      { label: "+10", desc: "Start with +10 lives." },
      { label: "+20", desc: "Start with +20 lives." },
      { label: "+50", desc: "Start with +50 lives." },
    ],
    costs: GENERAL_ADDON_GEM_COSTS.extraHealth,
  },
  startingGold: {
    key: "startingGold",
    label: "Extra Starting Gold",
    desc: "Gain bonus gold at the start of each run.",
    tiers: [
      { label: "+50g", desc: "Start with +50 gold." },
      { label: "+100g", desc: "Start with +100 gold." },
      { label: "+200g", desc: "Start with +200 gold." },
    ],
    costs: GENERAL_ADDON_GEM_COSTS.startingGold,
  },
  slowHealing: {
    key: "slowHealing",
    label: "Slow Healing",
    desc: "Restore health at the start of each round.",
    tiers: [
      { label: "+1/round", desc: "Regenerate 1 HP per wave." },
      { label: "+2/round", desc: "Regenerate 2 HP per wave." },
      { label: "+4/round", desc: "Regenerate 4 HP per wave." },
    ],
    costs: GENERAL_ADDON_GEM_COSTS.slowHealing,
  },
  sellOption: {
    key: "sellOption",
    label: "Sell Flexibility",
    desc: "Choose: full refund on sell, OR 25% cheaper tower builds (but can't sell).",
    tiers: [
      { label: "Full Refund", desc: "Sell towers for 100% of invested gold." },
      { label: "Discounted", desc: "Builds cost 25% less, but towers can't be sold." },
    ],
    costs: [SELL_OPTION_GEM_COST, SELL_OPTION_GEM_COST],
    isSellOption: true,
  },
  upgradeCostReduction: {
    key: "upgradeCostReduction",
    label: "Cheaper Upgrades",
    desc: "Reduce the gold cost of tower upgrades.",
    tiers: [
      { label: "-10%", desc: "Upgrades cost 10% less." },
      { label: "-25%", desc: "Upgrades cost 25% less." },
      { label: "-50%", desc: "Upgrades cost 50% less." },
    ],
    costs: GENERAL_ADDON_GEM_COSTS.upgradeCostReduction,
  },
  terrainHeightBonus: {
    key: "terrainHeightBonus",
    label: "Elevation Advantage",
    desc: "Towers on higher terrain deal more damage.",
    tiers: [
      { label: "+5%/lvl", desc: "+5% damage per terrain height level (max +20%)." },
      { label: "+10%/lvl", desc: "+10% damage per terrain height level (max +40%)." },
      { label: "+20%/lvl", desc: "+20% damage per terrain height level (max +80%)." },
    ],
    costs: GENERAL_ADDON_GEM_COSTS.terrainHeightBonus,
  },
  terrainHeightRangeBonus: {
    key: "terrainHeightRangeBonus",
    label: "Elevation Range",
    desc: "Towers on higher terrain gain bonus range.",
    tiers: [
      { label: "+0.25/lvl", desc: "+0.25 range per terrain height level (max +1)." },
      { label: "+0.5/lvl", desc: "+0.5 range per terrain height level (max +2)." },
      { label: "+1.0/lvl", desc: "+1.0 range per terrain height level (max +4)." },
    ],
    costs: GENERAL_ADDON_GEM_COSTS.terrainHeightRangeBonus,
  },
  damageMilestoneBonus: {
    key: "damageMilestoneBonus",
    label: "Damage Milestones",
    desc: "Towers gain bonus damage & speed per 1M total damage dealt.",
    tiers: [
      { label: "+5%/+2%", desc: "+5% dmg, +2% speed per 1M damage." },
      { label: "+10%/+5%", desc: "+10% dmg, +5% speed per 1M damage." },
      { label: "+20%/+10%", desc: "+20% dmg, +10% speed per 1M damage." },
    ],
    costs: GENERAL_ADDON_GEM_COSTS.damageMilestoneBonus,
  },
};

export function isGeneralUnlocked(save: SaveData, key: string, index: number): boolean {
  const generalAddons = save.generalAddons || {};
  if (key === "sellOption") {
    if (index === 0) return generalAddons.sellRefundUnlocked as boolean;
    if (index === 1) return generalAddons.sellDiscountUnlocked as boolean;
    return false;
  }
  return generalAddons[key] === index;
}

export function isGeneralAvailable(save: SaveData, key: string, index: number): boolean {
  if (isGeneralUnlocked(save, key, index)) return true;
  const def = GENERAL_ADDON_DEFS[key];
  if (!def) return false;
  const cost = def.costs[index]!;
  if (save.gems < cost) return false;
  if (key === "sellOption") {
    const generalAddons = save.generalAddons || {};
    if (!generalAddons.sellRefundUnlocked && !generalAddons.sellDiscountUnlocked) return false;
    return true;
  }
  if (index >= 1) {
    const prevUnlocked = isGeneralUnlocked(save, key, index - 1);
    if (!prevUnlocked) return false;
  }
  return true;
}

export function tryUnlockGeneral(save: SaveData, key: string, index: number) {
  if (isGeneralUnlocked(save, key, index)) return { ok: false, reason: "Already unlocked" };
  const def = GENERAL_ADDON_DEFS[key];
  if (!def) return { ok: false, reason: "Unknown add-on" };
  const cost = def.costs[index]!;
  if (save.gems < cost) return { ok: false, reason: "Not enough gems" };

  if (key === "sellOption") {
    const generalAddons = save.generalAddons || {};
    if (index === 0) {
      if (generalAddons.sellDiscountUnlocked as boolean) {
        generalAddons.sellActive = "refund";
        return { ok: true };
      }
      generalAddons.sellRefundUnlocked = true;
      generalAddons.sellDiscountUnlocked = true;
      generalAddons.sellActive = "refund";
      save.gems -= cost;
    } else if (index === 1) {
      if (generalAddons.sellRefundUnlocked as boolean) {
        generalAddons.sellActive = "discount";
        return { ok: true };
      }
      generalAddons.sellDiscountUnlocked = true;
      generalAddons.sellRefundUnlocked = true;
      generalAddons.sellActive = "discount";
      save.gems -= cost;
    }
    return { ok: true };
  }

  const current = save.generalAddons?.[key];
  if (current === index) return { ok: false, reason: "Already unlocked" };

  save.gems -= cost;
  if (!save.generalAddons) save.generalAddons = {};
  save.generalAddons[key] = index;
  return { ok: true };
}

export function getGeneralAddonValue(save: SaveData, key: string): number | string | null {
  const generalAddons = save.generalAddons || {};
  if (key === "sellOption") {
    return generalAddons.sellActive as string | null;
  }
  return generalAddons[key] as number | null;
}

export function getGeneralAddonTierData(save: SaveData, key: string) {
  const tier = getGeneralAddonValue(save, key);
  const def = GENERAL_ADDON_DEFS[key];
  if (!def || tier === null || tier === undefined) return null;
  return { tier, ...def.tiers[tier as number] };
}
