import { createRun, runReducer, RUN_STATE_VERSION } from '@naipes/engine';
import Storage from 'expo-sqlite/kv-store';
import { formatMult, formatNumber } from '@/game/format';
import { loadRun, saveRun } from '@/game/persistence';
import { buildPlayback } from '@/game/playback';
import { normalizeSeed, randomSeed } from '@/game/seed';
import { motion } from '@/theme/tokens';

describe('formatNumber (es-419)', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1240, '1.240'],
    [1234567, '1.234.567'],
    [1.2e9, '1,2e9'],
    [3.45e12, '3,4e12'],
  ])('%d → %s', (value, text) => expect(formatNumber(value)).toBe(text));

  it('shows one decimal for mult', () => {
    expect(formatMult(10.5)).toBe('10,5');
    expect(formatMult(7)).toBe('7');
  });
});

describe('seeds', () => {
  it('are readable and normalized', () => {
    expect(randomSeed(() => 0)).toBe('LUNA-100');
    expect(normalizeSeed('  luna-42 ')).toBe('LUNA-42');
  });
});

describe('buildPlayback', () => {
  it('labels each step and keeps the count under the time budget', () => {
    let { state } = createRun('PLAYBACK');
    const ids = state.hand.slice(0, 5).map((c) => c.id);
    const result = runReducer(state, { type: 'play', cardIds: ids });
    if (!result.ok) throw new Error(result.error.code);
    state = result.state;
    const event = result.events.find((e) => e.type === 'handScored');
    if (event?.type !== 'handScored') throw new Error('no handScored');
    const playback = buildPlayback(event);
    expect(playback.steps).toHaveLength(event.steps.length);
    expect(playback.steps.at(-1)!.chips * playback.steps.at(-1)!.mult).toBeCloseTo(
      event.chips * event.mult,
    );
    expect(playback.stepMs * playback.steps.length).toBeLessThanOrEqual(
      Math.max(motion.maxScoringMs, motion.duration.scoreStepMin * playback.steps.length),
    );
    expect(playback.steps.filter((s) => s.cardId).every((s) => s.label.startsWith('+'))).toBe(true);
  });
});

describe('persistence', () => {
  beforeEach(() => (Storage as unknown as { clear(): void }).clear());

  it('saves and loads a run in progress', () => {
    const { state } = createRun('SAVE');
    saveRun(state);
    expect(loadRun()).toEqual({ status: 'ok', run: state });
  });

  it('discards saves from another version or unreadable data', () => {
    Storage.setItemSync(
      'roguelike.run',
      JSON.stringify({ ...createRun('OLD').state, version: RUN_STATE_VERSION + 1 }),
    );
    expect(loadRun().status).toBe('corrupt');
    expect(loadRun().status).toBe('none');
    Storage.setItemSync('roguelike.run', '{not json');
    expect(loadRun().status).toBe('corrupt');
  });

  it('a finished run is not offered to continue', () => {
    const { state } = createRun('DONE');
    saveRun({ ...state, status: 'lost', phase: 'ended' });
    expect(loadRun().status).toBe('none');
  });
});
