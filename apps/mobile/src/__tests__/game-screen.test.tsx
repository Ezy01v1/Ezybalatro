import { DEFAULT_RUN_CONFIG, type RunConfig } from '@naipes/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { GameScreen } from '@/components/roguelike/GameScreen';
import { ShopScreen } from '@/components/roguelike/ShopScreen';
import { useGame } from '@/game/store';

/** Any single card beats every blind: lets the tests reach the shop deterministically. */
const EASY: RunConfig = {
  ...DEFAULT_RUN_CONFIG,
  anteTargets: [1, 1, 1, 1, 1, 1, 1, 1],
  startingMoney: 20,
};

function ConnectedGame() {
  const run = useGame((s) => s.run);
  return run ? <GameScreen run={run} /> : null;
}
function ConnectedShop() {
  const run = useGame((s) => s.run);
  return run ? <ShopScreen run={run} /> : null;
}

beforeEach(() => {
  jest.useFakeTimers();
  useGame.getState().exitRun();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('GameScreen', () => {
  it('selecting cards shows the hand preview; the 6th card is refused', async () => {
    useGame.getState().startRun('TEST-PREVIEW');
    await render(<ConnectedGame />);
    expect(screen.getByText('Elige hasta 5 cartas')).toBeTruthy();

    const hand = useGame.getState().run!.hand;
    await fireEvent.press(screen.getByTestId(`card-${hand[0]!.id}`));
    expect(screen.getByTestId('hand-preview')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Jugar mano/ })).toBeTruthy();

    for (const card of hand.slice(1, 6))
      await fireEvent.press(screen.getByTestId(`card-${card.id}`));
    expect(useGame.getState().selected).toHaveLength(5);
    expect(screen.getByTestId(`card-${hand[5]!.id}`).props.accessibilityState).toEqual({
      selected: false,
    });
  });

  it('playing a hand counts the score step by step and updates the total', async () => {
    useGame.getState().startRun('TEST-PLAY');
    await render(<ConnectedGame />);
    const card = useGame.getState().run!.hand[0]!;
    await fireEvent.press(screen.getByTestId(`card-${card.id}`));
    await fireEvent.press(screen.getByTestId('play-button'));

    expect(screen.getByTestId('scoring-stage')).toBeTruthy();
    const { playback } = useGame.getState();
    expect(playback).not.toBeNull();

    // One timer per step (each step schedules the next after rendering), then the result hold.
    for (let i = 0; i <= playback!.steps.length + 1; i++) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }
    expect(useGame.getState().playback).toBeNull();
    expect(useGame.getState().run!.roundScore).toBe(playback!.score);
    expect(screen.getByTestId('score-header').props.accessibilityLabel).toContain(
      String(playback!.score),
    );
  });

  it('tapping the play zone skips the count', async () => {
    useGame.getState().startRun('TEST-SKIP');
    await render(<ConnectedGame />);
    const card = useGame.getState().run!.hand[0]!;
    await fireEvent.press(screen.getByTestId(`card-${card.id}`));
    await fireEvent.press(screen.getByTestId('play-button'));
    await fireEvent.press(screen.getByHintText('Toca para saltar'));
    expect(useGame.getState().playback).toBeNull();
  });

  it('discarding spends a discard and deals new cards', async () => {
    useGame.getState().startRun('TEST-DISCARD');
    await render(<ConnectedGame />);
    const before = useGame.getState().run!;
    await fireEvent.press(screen.getByTestId(`card-${before.hand[0]!.id}`));
    await fireEvent.press(screen.getByTestId('discard-button'));
    const after = useGame.getState().run!;
    expect(after.discardsLeft).toBe(before.discardsLeft - 1);
    expect(after.hand.map((c) => c.id)).not.toContain(before.hand[0]!.id);
    expect(after.hand).toHaveLength(8);
  });

  it('sorting goes through the engine', async () => {
    useGame.getState().startRun('TEST-SORT');
    await render(<ConnectedGame />);
    await fireEvent.press(screen.getByTestId('sort-rank'));
    const ranks = useGame.getState().run!.hand.map((c) => c.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
  });

  it('the chosen order is kept when new cards are drawn (found on device)', async () => {
    useGame.getState().startRun('TEST-SORT-KEEP');
    await render(<ConnectedGame />);
    await fireEvent.press(screen.getByTestId('sort-suit'));
    const first = useGame.getState().run!.hand[0]!;
    await fireEvent.press(screen.getByTestId(`card-${first.id}`));
    await fireEvent.press(screen.getByTestId('discard-button'));
    const order = ['s', 'h', 'd', 'c'];
    const suits = useGame.getState().run!.hand.map((c) => order.indexOf(c.suit));
    expect(suits).toEqual([...suits].sort((a, b) => a - b));
  });
});

describe('ShopScreen', () => {
  async function reachShop() {
    useGame.getState().startRun('TEST-SHOP', EASY);
    useGame.getState().toggleCard(useGame.getState().run!.hand[0]!.id);
    useGame.getState().play();
    useGame.getState().finishPlayback();
    expect(useGame.getState().roundSummary).not.toBeNull();
    useGame.getState().dismissRoundSummary();
    expect(useGame.getState().run!.phase).toBe('shop');
    await render(<ConnectedShop />);
  }

  it('buying a joker spends money and fills a slot', async () => {
    await reachShop();
    const money = useGame.getState().run!.money;
    const offer = useGame.getState().run!.shop[0]!;
    await fireEvent.press(screen.getByTestId('buy-0'));
    expect(useGame.getState().run!.money).toBe(money - offer.price);
    expect(screen.getByTestId('joker-j1')).toBeTruthy();
    expect(screen.getByTestId('offer-0')).toHaveTextContent(/Comprado/);
  });

  it('reroll costs more each time', async () => {
    await reachShop();
    expect(screen.getByTestId('reroll-button')).toHaveTextContent(/Renovar \$3/);
    await fireEvent.press(screen.getByTestId('reroll-button'));
    expect(screen.getByTestId('reroll-button')).toHaveTextContent(/Renovar \$4/);
  });

  it('selling needs two taps', async () => {
    await reachShop();
    await fireEvent.press(screen.getByTestId('buy-0'));
    await act(async () => {
      fireGestureHandler(getByGestureTestId('joker-tap-j1'), [
        { state: State.BEGAN },
        { state: State.ACTIVE },
        { state: State.END },
      ]);
      jest.runAllTicks(); // scheduleOnRN delivers on a (faked) microtask
    });
    expect(screen.getByTestId('joker-detail')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('sell-button'));
    expect(useGame.getState().run!.jokers).toHaveLength(1);
    expect(screen.getByTestId('sell-button')).toHaveTextContent(/Confirmar venta/);
    await fireEvent.press(screen.getByTestId('sell-button'));
    expect(useGame.getState().run!.jokers).toHaveLength(0);
  });
});

describe('JokerRail', () => {
  it('dragging a joker reorders the jokers through the engine', async () => {
    useGame.getState().startRun('TEST-DRAG', EASY);
    const store = useGame.getState();
    store.toggleCard(store.run!.hand[0]!.id);
    store.play();
    useGame.getState().finishPlayback();
    useGame.getState().dismissRoundSummary();
    useGame.getState().buy(0);
    useGame.getState().buy(1);
    expect(useGame.getState().run!.jokers.map((j) => j.instanceId)).toEqual(['j1', 'j2']);
    await render(<ConnectedShop />);
    await act(async () => {
      fireGestureHandler(getByGestureTestId('joker-drag-j1'), [
        { state: State.BEGAN, translationX: 0 },
        { state: State.ACTIVE, translationX: 40 },
        { state: State.ACTIVE, translationX: 70 },
        { state: State.END, translationX: 70 },
      ]);
      jest.runAllTicks();
    });
    expect(useGame.getState().run!.jokers.map((j) => j.instanceId)).toEqual(['j2', 'j1']);
  });
});
