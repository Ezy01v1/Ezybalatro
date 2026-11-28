import type { TableUpdate } from '@naipes/shared';
import { renderHook } from '@testing-library/react-native';
import { haptics, playSound } from '../feedback/feedback';
import { effectFeedback, playEffects, useTableEffects } from '../table/useTableEffects';
import { diff, type Effect } from '../table/viewModel';

jest.mock('../feedback/feedback', () => ({
  playSound: jest.fn(),
  haptics: { light: jest.fn(), play: jest.fn(), win: jest.fn() },
}));
jest.mock('../table/viewModel', () => ({ diff: jest.fn() }));

const sound = playSound as jest.Mock;
const diffMock = diff as jest.Mock;

const upd = (seq: number, tableId = 't'): TableUpdate =>
  ({ tableId, seq, view: { mySeat: 0 } }) as unknown as TableUpdate;

beforeEach(() => jest.clearAllMocks());

describe('effectFeedback (design 4b §4)', () => {
  const cases: [Effect, string, keyof typeof haptics | null][] = [
    ['dealt', 'deal', null],
    [{ boardRevealed: 3 }, 'flip', null],
    [{ bet: 2 }, 'chips', null],
    ['checked', 'check', 'light'],
    ['myTurnStarted', 'turn', 'light'],
    ['myAllIn', 'chips', 'play'],
    ['iWon', 'win', 'win'],
  ];
  it.each(cases)('%j → %s + %s', (effect, s, h) => {
    effectFeedback(effect);
    expect(sound.mock.calls).toEqual([[s]]);
    for (const k of ['light', 'play', 'win'] as const) {
      expect(haptics[k]).toHaveBeenCalledTimes(k === h ? 1 : 0);
    }
  });

  it('streetClosed and awarded are silent (animation only)', () => {
    effectFeedback('streetClosed');
    effectFeedback({ awarded: { seat: 1, amount: 40 } });
    expect(sound).not.toHaveBeenCalled();
  });
});

describe('playEffects', () => {
  it('plays chips once for several bets and lets your all-in carry them', () => {
    playEffects([{ bet: 1 }, { bet: 2 }]);
    expect(sound.mock.calls).toEqual([['chips']]);
    sound.mockClear();
    playEffects([{ bet: 0 }, 'myAllIn']);
    expect(sound.mock.calls).toEqual([['chips']]);
    expect(haptics.play).toHaveBeenCalledTimes(1);
  });
});

describe('useTableEffects', () => {
  it('fires once per seq across re-renders and redelivery of the same seq', async () => {
    diffMock.mockReturnValue(['dealt']);
    const first = upd(1);
    const { rerender } = await renderHook(
      ({ u, p }: { u: TableUpdate | null; p: TableUpdate | null }) => useTableEffects(u, p),
      { initialProps: { u: first, p: null as TableUpdate | null } },
    );
    await rerender({ u: first, p: null });
    await rerender({ u: upd(1), p: null }); // same seq, new object (resync)
    expect(sound).toHaveBeenCalledTimes(1);
    expect(diffMock).toHaveBeenCalledWith(null, first, 0);

    await rerender({ u: upd(2), p: first });
    expect(sound).toHaveBeenCalledTimes(2);
    await rerender({ u: upd(2, 'other'), p: null }); // new table restarts seq
    expect(sound).toHaveBeenCalledTimes(3);
  });

  it('does nothing without an update', async () => {
    await renderHook(() => useTableEffects(null, null));
    expect(diffMock).not.toHaveBeenCalled();
  });
});
