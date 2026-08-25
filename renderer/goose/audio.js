// Original synthesized honk — no recorded audio anywhere in this project.
// A sawtooth "voice" swept through two bandpass formants with a soft-clip,
// plus a breathy noise attack. ±5% pitch jitter so repeated honks stay alive.

export class HonkSynth {
  constructor() {
    this.ctx = new AudioContext();
    this.muted = false;
  }

  honk(volume = 0.7) {
    if (this.muted) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.01;
    const jitter = 1 + (Math.random() * 2 - 1) * 0.05;
    const dur = 0.24 + Math.random() * 0.05;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(185 * jitter, t0);
    osc.frequency.exponentialRampToValueAtTime(250 * jitter, t0 + 0.035); // attack squawk
    osc.frequency.setValueAtTime(250 * jitter, t0 + 0.05);
    osc.frequency.exponentialRampToValueAtTime(165 * jitter, t0 + dur);

    // Nasal goose formants.
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 690 * jitter;
    f1.Q.value = 3.5;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1580 * jitter;
    f2.Q.value = 5;

    const shaper = ctx.createWaveShaper();
    shaper.curve = HonkSynth.softClipCurve(3.2);

    const voiceGain = ctx.createGain();
    voiceGain.gain.setValueAtTime(0, t0);
    voiceGain.gain.linearRampToValueAtTime(volume, t0 + 0.012);
    voiceGain.gain.setValueAtTime(volume, t0 + dur - 0.06);
    voiceGain.gain.linearRampToValueAtTime(0.0001, t0 + dur);

    // Breath transient.
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer();
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 1200;
    nf.Q.value = 1.2;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(volume * 0.35, t0);
    nGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);

    const master = ctx.createGain();
    master.gain.value = 0.85;

    osc.connect(f1);
    osc.connect(f2);
    f1.connect(shaper);
    f2.connect(shaper);
    shaper.connect(voiceGain).connect(master);
    noise.connect(nf).connect(nGain).connect(master);
    master.connect(ctx.destination);

    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    noise.start(t0);
    noise.stop(t0 + 0.06);
  }

  noiseBuffer() {
    if (!this._noise) {
      const len = this.ctx.sampleRate * 0.1;
      this._noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this._noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return this._noise;
  }

  static softClipCurve(drive) {
    const n = 512;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * drive);
    }
    return curve;
  }
}
