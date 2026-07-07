// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SoundManager } from "../../src/sound/SoundManager";

interface MockAudioContext {
  state: string;
  resume: ReturnType<typeof vi.fn>;
  createOscillator: ReturnType<typeof vi.fn>;
  createGain: ReturnType<typeof vi.fn>;
  destination: unknown;
  close: ReturnType<typeof vi.fn>;
}

describe("SoundManager", () => {
  let sm: SoundManager;

  beforeEach(() => {
    sm = new SoundManager();
  });

  describe("constructor", () => {
    it("initializes with enabled=true", () => {
      expect(sm.enabled).toBe(true);
    });

    it("initializes with ctx=null", () => {
      expect(sm.audioContext).toBeNull();
    });
  });

  describe("ensure()", () => {
    it("creates AudioContext on first call", () => {
      sm.ensure();
      expect(sm.audioContext).not.toBeNull();
    });

    it("does not create new AudioContext on second call", () => {
      sm.ensure();
      const ctx1 = sm.audioContext;
      sm.ensure();
      expect(sm.audioContext).toBe(ctx1);
    });

    it("sets enabled=false if AudioContext creation fails", () => {
      const origAudioContext = globalThis.AudioContext;
      globalThis.AudioContext = class {
        constructor() {
          throw new Error("AudioContext not supported");
        }
      } as unknown as typeof AudioContext;
      sm.ensure();
      expect(sm.enabled).toBe(false);
      globalThis.AudioContext = origAudioContext;
    });

    it("resumes suspended AudioContext", () => {
      sm.ensure();
      const resumeSpy = vi.fn();
      (sm.audioContext! as unknown as MockAudioContext).resume = resumeSpy;
      (sm.audioContext! as unknown as MockAudioContext).state = "suspended";
      sm.ensure();
      expect(resumeSpy).toHaveBeenCalled();
    });

    it("does not resume running AudioContext", () => {
      sm.ensure();
      const resumeSpy = vi.fn();
      (sm.audioContext! as unknown as MockAudioContext).resume = resumeSpy;
      (sm.audioContext! as unknown as MockAudioContext).state = "running";
      sm.ensure();
      expect(resumeSpy).not.toHaveBeenCalled();
    });
  });

  describe("play()", () => {
    it("does nothing when disabled", () => {
      sm.enabled = false;
      sm.play("shoot_basic");
      expect(sm.audioContext).toBeNull();
    });

    it("does nothing when ctx is null after ensure fails", () => {
      const origAudioContext = globalThis.AudioContext;
      globalThis.AudioContext = class {
        constructor() {
          throw new Error("AudioContext not supported");
        }
      } as unknown as typeof AudioContext;
      sm.ensure();
      expect(sm.audioContext).toBeNull();
      expect(sm.enabled).toBe(false);
      sm.play("shoot_basic");
      globalThis.AudioContext = origAudioContext;
    });

    it("creates oscillatorillator and gain node", () => {
      sm.play("shoot_basic");
      expect((sm.audioContext! as unknown as MockAudioContext).createOscillator).toHaveBeenCalled();
      expect((sm.audioContext! as unknown as MockAudioContext).createGain).toHaveBeenCalled();
    });

    it("connects oscillatorillator to gain and gain to destination", () => {
      sm.play("shoot_basic");
      const oscillator = (sm.audioContext?.createOscillator as unknown as MockAudioContext["createOscillator"]).mock
        .results[0].value;
      const gainNode = (sm.audioContext?.createGain as unknown as MockAudioContext["createGain"]).mock.results[0].value;
      expect(oscillator.connect).toHaveBeenCalledWith(gainNode);
      expect(gainNode.connect).toHaveBeenCalledWith(sm.audioContext?.destination);
    });

    it("sets oscillatorillator frequency and type for shoot_basic", () => {
      sm.play("shoot_basic");
      const oscillator = (sm.audioContext?.createOscillator as MockAudioContext["createOscillator"]).mock.results[0]
        .value;
      expect(oscillator.frequency.value).toBe(660);
      expect(oscillator.type).toBe("square");
    });

    it("sets oscillatorillator frequency and type for shoot_sniper", () => {
      sm.play("shoot_sniper");
      const oscillator = (sm.audioContext?.createOscillator as MockAudioContext["createOscillator"]).mock.results[0]
        .value;
      expect(oscillator.frequency.value).toBe(180);
      expect(oscillator.type).toBe("sawtooth");
    });

    it("sets oscillatorillator frequency and type for shoot_cannon", () => {
      sm.play("shoot_cannon");
      const oscillator = (sm.audioContext?.createOscillator as MockAudioContext["createOscillator"]).mock.results[0]
        .value;
      expect(oscillator.frequency.value).toBe(90);
      expect(oscillator.type).toBe("square");
    });

    it("sets oscillatorillator frequency and type for shoot_ice", () => {
      sm.play("shoot_ice");
      const oscillator = (sm.audioContext?.createOscillator as MockAudioContext["createOscillator"]).mock.results[0]
        .value;
      expect(oscillator.frequency.value).toBe(880);
      expect(oscillator.type).toBe("sine");
    });

    it("sets oscillatorillator frequency and type for shoot_lightning", () => {
      sm.play("shoot_lightning");
      const oscillator = (sm.audioContext?.createOscillator as MockAudioContext["createOscillator"]).mock.results[0]
        .value;
      expect(oscillator.frequency.value).toBe(1200);
      expect(oscillator.type).toBe("sawtooth");
    });

    it("sets oscillatorillator frequency and type for shoot_railgun", () => {
      sm.play("shoot_railgun");
      const oscillator = (sm.audioContext?.createOscillator as MockAudioContext["createOscillator"]).mock.results[0]
        .value;
      expect(oscillator.frequency.value).toBe(2400);
      expect(oscillator.type).toBe("sawtooth");
    });

    it("sets oscillatorillator frequency and type for place", () => {
      sm.play("place");
      const oscillator = (sm.audioContext?.createOscillator as MockAudioContext["createOscillator"]).mock.results[0]
        .value;
      expect(oscillator.frequency.value).toBe(300);
      expect(oscillator.type).toBe("triangle");
    });

    it("sets oscillatorillator frequency and type for base_hit", () => {
      sm.play("base_hit");
      const oscillator = (sm.audioContext?.createOscillator as MockAudioContext["createOscillator"]).mock.results[0]
        .value;
      expect(oscillator.frequency.value).toBe(80);
      expect(oscillator.type).toBe("square");
    });

    it("sets oscillatorillator frequency and type for boss_die", () => {
      sm.play("boss_die");
      const oscillator = (sm.audioContext?.createOscillator as MockAudioContext["createOscillator"]).mock.results[0]
        .value;
      expect(oscillator.frequency.value).toBe(60);
      expect(oscillator.type).toBe("sawtooth");
    });

    it("sets oscillatorillator frequency and type for sell", () => {
      sm.play("sell");
      const oscillator = (sm.audioContext?.createOscillator as MockAudioContext["createOscillator"]).mock.results[0]
        .value;
      expect(oscillator.frequency.value).toBe(520);
      expect(oscillator.type).toBe("triangle");
    });

    it("sets oscillatorillator frequency and type for cancel", () => {
      sm.play("cancel");
      const oscillator = (sm.audioContext?.createOscillator as MockAudioContext["createOscillator"]).mock.results[0]
        .value;
      expect(oscillator.frequency.value).toBe(200);
      expect(oscillator.type).toBe("sine");
    });

    it("calls setValueAtTime on gain", () => {
      sm.play("shoot_basic");
      const gainNode = (sm.audioContext?.createGain as MockAudioContext["createGain"]).mock.results[0].value;
      expect(gainNode.gain.setValueAtTime).toHaveBeenCalled();
    });

    it("calls exponentialRampToValueAtTime on gain", () => {
      sm.play("shoot_basic");
      const gainNode = (sm.audioContext?.createGain as MockAudioContext["createGain"]).mock.results[0].value;
      expect(gainNode.gain.exponentialRampToValueAtTime).toHaveBeenCalled();
    });

    it("calls start and stop on oscillatorillator", () => {
      sm.play("shoot_basic");
      const oscillator = (sm.audioContext?.createOscillator as MockAudioContext["createOscillator"]).mock.results[0]
        .value;
      expect(oscillator.start).toHaveBeenCalled();
      expect(oscillator.stop).toHaveBeenCalled();
    });
  });

  describe("dispose()", () => {
    it("closes AudioContext and sets ctx to null", () => {
      sm.ensure();
      const closeSpy = vi.fn();
      (sm.audioContext! as unknown as { close: ReturnType<typeof vi.fn> }).close = closeSpy;
      sm.dispose();
      expect(closeSpy).toHaveBeenCalled();
      expect(sm.audioContext).toBeNull();
    });

    it("does nothing when ctx is null", () => {
      const closeSpy = vi.fn();
      sm.dispose();
      expect(closeSpy).not.toHaveBeenCalled();
    });
  });
});
