// Lightweight WebAudio synth — no external assets needed.

type SoundName =
  | "shoot_basic"
  | "shoot_sniper"
  | "shoot_cannon"
  | "shoot_ice"
  | "shoot_lightning"
  | "shoot_railgun"
  | "place"
  | "base_hit"
  | "boss_die";

export class SoundManager {
  audioContext: AudioContext | null;
  enabled: boolean;

  constructor() {
    this.audioContext = null;
    this.enabled = true;
  }

  ensure(): void {
    if (!this.audioContext) {
      try {
        // biome-ignore lint/suspicious/noExplicitAny: webkitAudioContext fallback for older browsers
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch {
        this.enabled = false;
      }
    }
    if (this.audioContext && this.audioContext.state === "suspended") {
      this.audioContext.resume();
    }
  }

  play(name: SoundName): void {
    if (!this.enabled) return;
    this.ensure();
    if (!this.audioContext) return;
    const audioCtx = this.audioContext;
    const now = audioCtx.currentTime;
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    let freq = 440,
      type: OscillatorType = "sine",
      dur = 0.1,
      vol = 0.06;
    if (name.startsWith("shoot")) {
      if (name.includes("basic")) {
        freq = 660;
        type = "square";
        dur = 0.05;
      } else if (name.includes("sniper")) {
        freq = 180;
        type = "sawtooth";
        dur = 0.15;
        vol = 0.08;
      } else if (name.includes("cannon")) {
        freq = 90;
        type = "square";
        dur = 0.2;
        vol = 0.1;
      } else if (name.includes("ice")) {
        freq = 880;
        type = "sine";
        dur = 0.1;
      } else if (name.includes("lightning")) {
        freq = 1200;
        type = "sawtooth";
        dur = 0.06;
      } else if (name.includes("railgun")) {
        freq = 2400;
        type = "sawtooth";
        dur = 0.08;
      }
    } else if (name === "place") {
      freq = 300;
      type = "triangle";
      dur = 0.1;
      vol = 0.08;
    } else if (name === "base_hit") {
      freq = 80;
      type = "square";
      dur = 0.3;
      vol = 0.12;
    } else if (name === "boss_die") {
      freq = 60;
      type = "sawtooth";
      dur = 0.6;
      vol = 0.15;
    }
    oscillator.type = type;
    oscillator.frequency.value = freq;
    gainNode.gain.setValueAtTime(vol, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + dur);
    oscillator.start(now);
    oscillator.stop(now + dur);
  }

  dispose(): void {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}
