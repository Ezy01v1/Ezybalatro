import { type ScoreStep } from '@naipes/engine';
import { buildPlayback } from '@/game/playback';
import { motion } from '@/theme/tokens';

const base: ScoreStep = {
  source: { kind: 'base', handType: 'pair', level: 1 },
  effect: { chips: 12, mult: 2 },
  chips: 12,
  mult: 2,
};
const event = (steps: ScoreStep[]) => ({
  handType: 'pair' as const,
  playedIds: ['7h', '7d'],
  scoringIds: ['7h', '7d'],
  steps,
  score: 100,
  roundScore: 100,
});

describe('buildPlayback: the 5c steps', () => {
  it('marks a repeated pass of a card with the repeat glyph, keeping its tone and card', () => {
    const playback = buildPlayback(
      event([
        base,
        { source: { kind: 'card', cardId: '7h' }, effect: { chips: 7 }, chips: 19, mult: 2 },
        {
          source: { kind: 'card', cardId: '7h', repeat: 1 },
          effect: { chips: 7 },
          chips: 26,
          mult: 2,
        },
      ]),
    );
    expect(playback.steps[1]).toMatchObject({ cardId: '7h', label: '+7', tone: 'chips' });
    expect(playback.steps[2]).toMatchObject({
      cardId: '7h',
      label: '↻ +7',
      tone: 'chips',
      repeat: 1,
    });
    expect(playback.steps[1]!.repeat).toBeUndefined();
  });

  it('marks a repeated joker or enhancement pass too', () => {
    const playback = buildPlayback(
      event([
        base,
        {
          source: {
            kind: 'enhancement',
            cardId: '7h',
            enhancement: 'charged',
            held: false,
            repeat: 2,
          },
          effect: { mult: 4 },
          chips: 12,
          mult: 6,
        },
        {
          source: {
            kind: 'joker',
            instanceId: 'j1',
            jokerId: 'ember',
            hook: 'onCardScored',
            cardId: '7h',
            repeat: 1,
          },
          effect: { xMult: 1.5 },
          chips: 12,
          mult: 9,
        },
      ]),
    );
    expect(playback.steps[1]!.label.startsWith('↻ ')).toBe(true);
    expect(playback.steps[2]).toMatchObject({ instanceId: 'j1', tone: 'xmult' });
    expect(playback.steps[2]!.label.startsWith('↻ ')).toBe(true);
  });

  it('an edition step pulses its joker and reads like any bonus', () => {
    const playback = buildPlayback(
      event([
        base,
        {
          source: { kind: 'joker', instanceId: 'j2', jokerId: 'ember', hook: 'edition' },
          effect: { chips: 50 },
          chips: 62,
          mult: 2,
        },
      ]),
    );
    expect(playback.steps[1]).toMatchObject({ instanceId: 'j2', label: '+50', tone: 'chips' });
    expect(playback.steps[1]!.label.startsWith('↻')).toBe(false);
  });

  it('a long hand with many repeats keeps each step between the min and base durations', () => {
    const steps: ScoreStep[] = [base];
    for (let i = 0; i < 20; i++) {
      steps.push({
        source: { kind: 'card', cardId: '7h', ...(i > 0 ? { repeat: i } : {}) },
        effect: { chips: 7 },
        chips: 12 + 7 * (i + 1),
        mult: 2,
      });
    }
    const { stepMs } = buildPlayback(event(steps));
    expect(stepMs).toBeGreaterThanOrEqual(motion.duration.scoreStepMin);
    expect(stepMs).toBeLessThanOrEqual(motion.duration.scoreStep);
  });
});
