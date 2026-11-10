/**
 * Tiny synthesised sound set: honks that layer into a chorus, a soft ding per
 * cleared vehicle, and a gridlock swell. No assets to load.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  muted = false;
  private lastDing = 0;
  private honksThisSecond = 0;
  private honkWindow = 0;

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Call from a user gesture so the context is allowed to start. */
  unlock(): void {
    this.ensure();
  }

  honk(strong: boolean): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.honkWindow > 1) {
      this.honkWindow = now;
      this.honksThisSecond = 0;
    }
    if (this.honksThisSecond++ > 6) return; // chorus, not cacophony
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    const base = strong ? 300 + Math.random() * 60 : 380 + Math.random() * 80;
    osc.type = 'sawtooth';
    osc2.type = 'square';
    osc.frequency.value = base;
    osc2.frequency.value = base * 1.26;
    const dur = strong ? 0.35 : 0.18;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(strong ? 0.08 : 0.05, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc2.start(now);
    osc.stop(now + dur);
    osc2.stop(now + dur);
  }

  ding(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastDing < 0.06) return;
    this.lastDing = now;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880 + Math.random() * 120;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.035, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  }

  gridlock(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (let i = 0; i < 6; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = 220 + i * 37 + Math.random() * 20;
      const t0 = now + i * 0.12;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.05, t0 + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 1.5);
    }
  }
}
