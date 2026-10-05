#!/usr/bin/env node
/**
 * Generates the placeholder sound effects as small WAV files (22.05 kHz, mono, 16-bit).
 * They are synthesized here from simple tones and noise, so they are original work released
 * under CC0 (see assets/sfx/LICENSE.md). Re-run after changing a recipe:
 *   node apps/mobile/scripts/generate-sfx.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 22050;
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sfx');
mkdirSync(outDir, { recursive: true });

/** Deterministic noise (no Math.random so the files are reproducible). */
let noiseState = 12345;
const noise = () => {
  noiseState = (noiseState * 1103515245 + 12345) & 0x7fffffff;
  return noiseState / 0x3fffffff - 1;
};

/** A note: frequency glide from `f0` to `f1`, exponential decay, optional square-ish timbre. */
function tone({ f0, f1 = f0, ms, gain = 0.5, decay = 6, harmonics = 0, start = 0 }) {
  return { kind: 'tone', f0, f1, ms, gain, decay, harmonics, start };
}
function burst({ ms, gain = 0.3, decay = 18, start = 0 }) {
  return { kind: 'noise', ms, gain, decay, start };
}

function render(parts) {
  const totalMs = Math.max(...parts.map((p) => p.start + p.ms));
  const samples = new Float32Array(Math.ceil((totalMs / 1000) * RATE));
  for (const p of parts) {
    const offset = Math.floor((p.start / 1000) * RATE);
    const length = Math.floor((p.ms / 1000) * RATE);
    let phase = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const envelope = Math.min(1, i / (RATE * 0.003)) * Math.exp(-p.decay * t);
      let value;
      if (p.kind === 'noise') {
        value = noise();
      } else {
        const freq = p.f0 + (p.f1 - p.f0) * t;
        phase += (2 * Math.PI * freq) / RATE;
        value = Math.sin(phase);
        for (let h = 1; h <= p.harmonics; h++) value += Math.sin(phase * (2 * h + 1)) / (2 * h + 1);
      }
      samples[offset + i] += value * envelope * p.gain;
    }
  }
  return samples;
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) =>
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2),
  );
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const recipes = {
  select: [tone({ f0: 1320, ms: 45, gain: 0.35, decay: 9 })],
  deal: [burst({ ms: 60, gain: 0.25, decay: 22 }), tone({ f0: 300, f1: 180, ms: 60, gain: 0.15 })],
  play: [
    burst({ ms: 140, gain: 0.18, decay: 8 }),
    tone({ f0: 260, f1: 520, ms: 140, gain: 0.2, decay: 4 }),
  ],
  chips: [tone({ f0: 880, ms: 70, gain: 0.3, decay: 10, harmonics: 1 })],
  mult: [tone({ f0: 660, ms: 90, gain: 0.3, decay: 8, harmonics: 2 })],
  joker: [
    tone({ f0: 784, ms: 80, gain: 0.3, decay: 7, harmonics: 1 }),
    tone({ f0: 1175, ms: 120, gain: 0.3, decay: 6, harmonics: 1, start: 70 }),
  ],
  win: [523, 659, 784, 1047].map((f, i) =>
    tone({ f0: f, ms: 220, gain: 0.28, decay: 4, harmonics: 1, start: i * 90 }),
  ),
  lose: [440, 370, 311].map((f, i) =>
    tone({ f0: f, f1: f * 0.97, ms: 260, gain: 0.28, decay: 3, start: i * 160 }),
  ),
  coin: [
    tone({ f0: 1568, ms: 60, gain: 0.25, decay: 8 }),
    tone({ f0: 2093, ms: 140, gain: 0.25, decay: 6, start: 50 }),
  ],
};

for (const [name, parts] of Object.entries(recipes)) {
  writeFileSync(join(outDir, `${name}.wav`), wav(render(parts)));
  console.log(`assets/sfx/${name}.wav`);
}
