// ===== Enemy Types =====
// - base stats per enemy type, used as foundation for HP/bounty calculations

export interface EnemyWalkingFrame {
  name: string;
  svg: string;
  duration: number;
}

export interface EnemyWalkingConfig {
  referenceImages: EnemyWalkingFrame[];
  duration: number;
  default?: boolean;
}

export interface EnemyMeta {
  name: string;
  baseHp: number;
  speed: number;
  bounty: number;
  color: string;
  radius: number;
  shape: string;
  shield?: number;
  heal?: number;
  healRange?: number;
  resist?: number;
  slowResist?: number;
  walking?: EnemyWalkingConfig;
  hitReaction?: EnemyWalkingConfig;
}

export type EnemyType = "minion" | "runner" | "tank" | "shielded" | "healer" | "boss";

// referenced in Enemy.js for meta lookup, Game.js for bounty, ProjectileManager.js for type checks
export const ENEMY_TYPES: Record<string, EnemyMeta> = {
  minion: {
    name: "Minion",
    baseHp: 8,
    speed: 1.0,
    bounty: 2,
    color: "#e85a6a",
    radius: 0.4,
    shape: "circle",
    walking: {
      referenceImages: [
        {
          name: "frame0",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><circle cx="0" cy="0" r="0.37" fill="#e85a6a" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.098,
        },
        {
          name: "frame1",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><circle cx="0" cy="0" r="0.35" fill="#e85a6a" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.098,
        },
        {
          name: "frame2",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><circle cx="0" cy="0" r="0.36" fill="#e85a6a" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.098,
        },
        {
          name: "frame3",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><circle cx="0" cy="0" r="0.37" fill="#e85a6a" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.098,
        },
        {
          name: "frame4",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><circle cx="0" cy="0" r="0.38" fill="#e85a6a" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.098,
        },
        {
          name: "frame5",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><circle cx="0" cy="0" r="0.37" fill="#e85a6a" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.098,
        },
        {
          name: "frame6",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><circle cx="0" cy="0" r="0.36" fill="#e85a6a" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.098,
        },
        {
          name: "frame7",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><circle cx="0" cy="0" r="0.35" fill="#e85a6a" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.098,
        },
      ],
      duration: 0.784,
      default: true,
    },
    hitReaction: {
      referenceImages: [
        {
          name: "hit0",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><circle cx="0" cy="0" r="0.37" fill="#ff4444" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.04,
        },
        {
          name: "hit1",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><circle cx="0" cy="0" r="0.35" fill="#ff4444" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.04,
        },
        {
          name: "hit2",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><circle cx="0" cy="0" r="0.35" fill="#ff4444" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.04,
        },
      ],
      duration: 0.12,
    },
  },
  runner: {
    name: "Runner",
    baseHp: 8,
    speed: 2.5,
    bounty: 4,
    color: "#ffd84d",
    radius: 0.4,
    shape: "triangle",
    walking: {
      referenceImages: [
        {
          name: "frame0",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0,-0.24 0.262,0.18 -0.262,0.18" fill="#ffd84d" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.063,
        },
        {
          name: "frame1",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0,-0.26 0.252,0.16 -0.252,0.16" fill="#ffd84d" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.063,
        },
        {
          name: "frame2",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0,-0.28 0.242,0.14 -0.242,0.14" fill="#ffd84d" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.063,
        },
        {
          name: "frame3",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0,-0.30 0.232,0.12 -0.232,0.12" fill="#ffd84d" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.063,
        },
        {
          name: "frame4",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0,-0.32 0.222,0.10 -0.222,0.10" fill="#ffd84d" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.063,
        },
        {
          name: "frame5",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0,-0.30 0.232,0.12 -0.232,0.12" fill="#ffd84d" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.063,
        },
        {
          name: "frame6",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0,-0.28 0.242,0.14 -0.242,0.14" fill="#ffd84d" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.063,
        },
        {
          name: "frame7",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0,-0.26 0.252,0.16 -0.252,0.16" fill="#ffd84d" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.063,
        },
      ],
      duration: 0.504,
      default: true,
    },
    hitReaction: {
      referenceImages: [
        {
          name: "hit0",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0,-0.24 0.262,0.18 -0.262,0.18" fill="#ff4444" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.04,
        },
        {
          name: "hit1",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0,-0.228 0.249,0.171 -0.249,0.171" fill="#ff4444" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.04,
        },
        {
          name: "hit2",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0,-0.228 0.249,0.171 -0.249,0.171" fill="#ff4444" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.04,
        },
      ],
      duration: 0.12,
    },
  },
  tank: {
    name: "Tank",
    baseHp: 32,
    speed: 0.4,
    bounty: 5,
    color: "#7a8a9a",
    radius: 0.4,
    shape: "square",
    walking: {
      referenceImages: [
        {
          name: "frame0",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><rect x="-0.48" y="-0.40" width="0.96" height="0.96" fill="#7a8a9a" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.15,
        },
        {
          name: "frame1",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><rect x="-0.48" y="-0.44" width="0.96" height="0.96" fill="#7a8a9a" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.15,
        },
        {
          name: "frame2",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><rect x="-0.48" y="-0.48" width="0.96" height="0.96" fill="#7a8a9a" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.15,
        },
        {
          name: "frame3",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><rect x="-0.48" y="-0.52" width="0.96" height="0.96" fill="#7a8a9a" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.15,
        },
        {
          name: "frame4",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><rect x="-0.48" y="-0.56" width="0.96" height="0.96" fill="#7a8a9a" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.15,
        },
        {
          name: "frame5",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><rect x="-0.48" y="-0.52" width="0.96" height="0.96" fill="#7a8a9a" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.15,
        },
        {
          name: "frame6",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><rect x="-0.48" y="-0.48" width="0.96" height="0.96" fill="#7a8a9a" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.15,
        },
        {
          name: "frame7",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><rect x="-0.48" y="-0.44" width="0.96" height="0.96" fill="#7a8a9a" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.15,
        },
      ],
      duration: 1.2,
      default: true,
    },
    hitReaction: {
      referenceImages: [
        {
          name: "hit0",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><rect x="-0.48" y="-0.40" width="0.96" height="0.96" fill="#ff4444" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.04,
        },
        {
          name: "hit1",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><rect x="-0.456" y="-0.38" width="0.912" height="0.912" fill="#ff4444" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.04,
        },
        {
          name: "hit2",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><rect x="-0.456" y="-0.38" width="0.912" height="0.912" fill="#ff4444" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.04,
        },
      ],
      duration: 0.12,
    },
  },
  shielded: {
    name: "Shielded",
    baseHp: 16,
    speed: 0.7,
    bounty: 6,
    color: "#5fd0ff",
    radius: 0.4,
    shape: "hexagon",
    shield: 32,
    walking: {
      referenceImages: [
        {
          name: "frame0",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0.416,0 0.208,0.36 -0.208,0.36 -0.416,0 -0.208,-0.36 0.208,-0.36" fill="#5fd0ff" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.125,
        },
        {
          name: "frame1",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0.408,0 0.204,0.353 -0.204,0.353 -0.408,0 -0.204,-0.353 0.204,-0.353" fill="#5fd0ff" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.125,
        },
        {
          name: "frame2",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0.400,0 0.200,0.346 -0.200,0.346 -0.400,0 -0.200,-0.346 0.200,-0.346" fill="#5fd0ff" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.125,
        },
        {
          name: "frame3",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0.392,0 0.196,0.339 -0.196,0.339 -0.392,0 -0.196,-0.339 0.196,-0.339" fill="#5fd0ff" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.125,
        },
        {
          name: "frame4",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0.384,0 0.192,0.333 -0.192,0.333 -0.384,0 -0.192,-0.333 0.192,-0.333" fill="#5fd0ff" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.125,
        },
        {
          name: "frame5",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0.392,0 0.196,0.339 -0.196,0.339 -0.392,0 -0.196,-0.339 0.196,-0.339" fill="#5fd0ff" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.125,
        },
        {
          name: "frame6",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0.400,0 0.200,0.346 -0.200,0.346 -0.400,0 -0.200,-0.346 0.200,-0.346" fill="#5fd0ff" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.125,
        },
        {
          name: "frame7",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0.408,0 0.204,0.353 -0.204,0.353 -0.408,0 -0.204,-0.353 0.204,-0.353" fill="#5fd0ff" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.125,
        },
      ],
      duration: 1.0,
      default: true,
    },
    hitReaction: {
      referenceImages: [
        {
          name: "hit0",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0.416,0 0.208,0.36 -0.208,0.36 -0.416,0 -0.208,-0.36 0.208,-0.36" fill="#ff4444" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.04,
        },
        {
          name: "hit1",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0.395,0 0.198,0.342 -0.198,0.342 -0.395,0 -0.198,-0.342 0.198,-0.342" fill="#ff4444" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.04,
        },
        {
          name: "hit2",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0.395,0 0.198,0.342 -0.198,0.342 -0.395,0 -0.198,-0.342 0.198,-0.342" fill="#ff4444" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.04,
        },
      ],
      duration: 0.12,
    },
  },
  healer: {
    name: "Healer",
    baseHp: 16,
    speed: 0.8,
    bounty: 7,
    color: "#5fff8a",
    radius: 0.36,
    shape: "cross",
    heal: 0.03,
    healRange: 2.5,
    walking: {
      referenceImages: [
        {
          name: "frame0",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="-0.33,-0.108 0.39,-0.108 0.39,0.108 -0.33,0.108 -0.078,-0.36 0.138,-0.36 0.138,0.36 -0.078,0.36" fill="#5fff8a" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.125,
        },
        {
          name: "frame1",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="-0.345,-0.108 0.375,-0.108 0.375,0.108 -0.345,0.108 -0.093,-0.36 0.123,-0.36 0.123,0.36 -0.093,0.36" fill="#5fff8a" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.125,
        },
        {
          name: "frame2",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="-0.36,-0.108 0.36,-0.108 0.36,0.108 -0.36,0.108 -0.108,-0.36 0.108,-0.36 0.108,0.36 -0.108,0.36" fill="#5fff8a" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.125,
        },
        {
          name: "frame3",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="-0.375,-0.108 0.345,-0.108 0.345,0.108 -0.375,0.108 -0.123,-0.36 0.093,-0.36 0.093,0.36 -0.123,0.36" fill="#5fff8a" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.125,
        },
        {
          name: "frame4",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="-0.39,-0.108 0.33,-0.108 0.33,0.108 -0.39,0.108 -0.138,-0.36 0.078,-0.36 0.078,0.36 -0.138,0.36" fill="#5fff8a" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.125,
        },
        {
          name: "frame5",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="-0.375,-0.108 0.345,-0.108 0.345,0.108 -0.375,0.108 -0.123,-0.36 0.093,-0.36 0.093,0.36 -0.123,0.36" fill="#5fff8a" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.125,
        },
        {
          name: "frame6",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="-0.36,-0.108 0.36,-0.108 0.36,0.108 -0.36,0.108 -0.108,-0.36 0.108,-0.36 0.108,0.36 -0.108,0.36" fill="#5fff8a" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.125,
        },
        {
          name: "frame7",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="-0.345,-0.108 0.375,-0.108 0.375,0.108 -0.345,0.108 -0.093,-0.36 0.123,-0.36 0.123,0.36 -0.093,0.36" fill="#5fff8a" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.125,
        },
      ],
      duration: 1.0,
      default: true,
    },
    hitReaction: {
      referenceImages: [
        {
          name: "hit0",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="-0.33,-0.108 0.39,-0.108 0.39,0.108 -0.33,0.108 -0.078,-0.36 0.138,-0.36 0.138,0.36 -0.078,0.36" fill="#ff4444" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.04,
        },
        {
          name: "hit1",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="-0.314,-0.103 0.371,-0.103 0.371,0.103 -0.314,0.103 -0.074,-0.342 0.131,-0.342 0.131,0.342 -0.074,0.342" fill="#ff4444" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.04,
        },
        {
          name: "hit2",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="-0.314,-0.103 0.371,-0.103 0.371,0.103 -0.314,0.103 -0.074,-0.342 0.131,-0.342 0.131,0.342 -0.074,0.342" fill="#ff4444" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.04,
        },
      ],
      duration: 0.12,
    },
  },
  boss: {
    name: "Boss",
    baseHp: 256,
    speed: 0.5,
    bounty: 100,
    color: "#c98aff",
    radius: 0.6,
    shape: "star",
    resist: 0.3,
    slowResist: 0.8,
    walking: {
      referenceImages: [
        {
          name: "frame0",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0,-0.6 0.206,-0.183 0.666,-0.116 0.333,0.208 0.411,0.666 0,0.45 -0.411,0.666 -0.333,0.208 -0.666,-0.116 -0.206,-0.183" fill="#c98aff" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.188,
        },
        {
          name: "frame1",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0.014,-0.65 0.211,-0.229 0.67,-0.153 0.331,0.165 0.4,0.624 -0.007,0.4 -0.423,0.608 -0.335,0.151 -0.661,-0.18 -0.2,-0.237" fill="#c98aff" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.188,
        },
        {
          name: "frame2",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0.028,-0.699 0.217,-0.275 0.674,-0.19 0.328,0.121 0.388,0.582 -0.014,0.35 -0.434,0.549 -0.337,0.095 -0.657,-0.243 -0.194,-0.291" fill="#c98aff" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.188,
        },
        {
          name: "frame3",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0.014,-0.75 0.211,-0.329 0.67,-0.253 0.331,0.065 0.4,0.524 -0.007,0.3 -0.423,0.508 -0.335,0.051 -0.661,-0.28 -0.2,-0.337" fill="#c98aff" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.188,
        },
        {
          name: "frame4",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0,-0.8 0.206,-0.383 0.666,-0.316 0.333,0.008 0.411,0.466 0,0.25 -0.411,0.466 -0.333,0.008 -0.666,-0.316 -0.206,-0.383" fill="#c98aff" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.188,
        },
        {
          name: "frame5",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="-0.014,-0.75 0.2,-0.337 0.661,-0.28 0.335,0.051 0.423,0.508 0.007,0.3 -0.4,0.524 -0.331,0.065 -0.67,-0.253 -0.211,-0.329" fill="#c98aff" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.188,
        },
        {
          name: "frame6",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="-0.028,-0.699 0.194,-0.291 0.657,-0.243 0.337,0.095 0.434,0.549 0.014,0.35 -0.388,0.582 -0.328,0.121 -0.674,-0.19 -0.217,-0.275" fill="#c98aff" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.188,
        },
        {
          name: "frame7",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="-0.014,-0.65 0.2,-0.237 0.661,-0.18 0.335,0.151 0.423,0.608 0.007,0.4 -0.4,0.624 -0.331,0.165 -0.67,-0.153 -0.211,-0.229" fill="#c98aff" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.188,
        },
      ],
      duration: 1.504,
      default: true,
    },
    hitReaction: {
      referenceImages: [
        {
          name: "hit0",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0,-0.6 0.206,-0.183 0.666,-0.116 0.333,0.208 0.411,0.666 0,0.45 -0.411,0.666 -0.333,0.208 -0.666,-0.116 -0.206,-0.183" fill="#ff4444" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.04,
        },
        {
          name: "hit1",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0,-0.57 0.196,-0.174 0.633,-0.11 0.316,0.198 0.39,0.633 0,0.428 -0.39,0.633 -0.316,0.198 -0.633,-0.11 -0.196,-0.174" fill="#ff4444" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.04,
        },
        {
          name: "hit2",
          svg: '<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg"><polygon points="0,-0.57 0.196,-0.174 0.633,-0.11 0.316,0.198 0.39,0.633 0,0.428 -0.39,0.633 -0.316,0.198 -0.633,-0.11 -0.196,-0.174" fill="#ff4444" stroke="rgba(0,0,0,0.5)" stroke-width="0.04"/></svg>',
          duration: 0.04,
        },
      ],
      duration: 0.12,
    },
  },
};

// HP = baseHp * ENEMY_LEVEL_HP_MULT(level) * (1 + 0.2*(wave-1)) (Enemy.js)

// level HP multiplier: 1 + 0.6*(level-1) (Enemy.js)
export const ENEMY_LEVEL_HP_MULT = (level: number): number => 1 + 0.6 * (level - 1);
// wave HP/damage multiplier: 1 + ENEMY_WAVE_DAMAGE_MULT*(wave-1) (Enemy.js)
export const ENEMY_WAVE_DAMAGE_MULT = 0.2;
// boss stun duration reduced to 30% of normal (Enemy.js)
export const BOSS_STUN_REDUCTION = 0.3;
// minimum speed factor, prevents infinite slow stacking: Math.max(MIN_SLOW_FACTOR, slowFactor) (Enemy.js)
export const MIN_SLOW_FACTOR = 0.1;

// ===== Wave Generation =====

// base enemy count per wave: WAVE_COUNT_BASE + floor(n * WAVE_COUNT_SCALE) (WaveManager.js)
export const WAVE_COUNT_BASE = 5;
// wave count scale: WAVE_COUNT_BASE + floor(wave * WAVE_COUNT_SCALE) enemies (WaveManager.js)
export const WAVE_COUNT_SCALE = 1.3;
// boss spawn every N waves per region: n % cadence === 0 (Map.js, WaveManager.js)
export const BOSS_CADENCE = [10, 8, 5] as const;
