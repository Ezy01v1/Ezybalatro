import { DEFAULT_RUN_CONFIG, type JokerInstance, type RunConfig } from '@naipes/engine';
import { act, render, screen, within } from '@testing-library/react-native';
import { ShopScreen } from '@/components/roguelike/ShopScreen';
import { useGame } from '@/game/store';
import { es } from '@/i18n/es';

const EASY: RunConfig = {
  ...DEFAULT_RUN_CONFIG,
  anteTargets: [1, 1, 1, 1, 1, 1, 1, 1],
  startingMoney: 50,
  editionOneIn: 0,
};

function ConnectedShop() {
  const run = useGame((s) => s.run);
  return run ? <ShopScreen run={run} /> : null;
}

const joker = (n: number, edition?: string): JokerInstance => ({
  instanceId: `j${n}`,
  jokerId: ['ember', 'prism', 'fan', 'saver', 'figurine'][n - 1]!,
  state: {},
  ...(edition ? { edition } : {}),
});

function reachShop(jokers: JokerInstance[]) {
  useGame.getState().startRun('SLOTS', EASY);
  useGame.getState().toggleCard(useGame.getState().run!.hand[0]!.id);
  useGame.getState().play();
  useGame.getState().finishPlayback();
  useGame.getState().dismissRoundSummary();
  useGame.setState({ run: { ...useGame.getState().run!, jokers } });
}

beforeEach(() => {
  jest.useFakeTimers();
  useGame.getState().exitRun();
});
afterEach(() => jest.useRealTimers());

describe('joker slots with the ample edition', () => {
  it('five plain jokers fill a five-slot rail: no empty slot', async () => {
    reachShop([1, 2, 3, 4, 5].map((n) => joker(n)));
    await render(<ConnectedShop />);
    expect(screen.queryAllByLabelText(es.game.emptySlot)).toHaveLength(0);
  });

  it('an ample joker among five opens a sixth slot in the rail', async () => {
    reachShop([1, 2, 3, 4, 5].map((n) => joker(n, n === 5 ? 'ample' : undefined)));
    await render(<ConnectedShop />);
    expect(screen.queryAllByLabelText(es.game.emptySlot)).toHaveLength(1);
  });

  it('the shop lets you buy a sixth joker when the ample one is owned', async () => {
    reachShop([1, 2, 3, 4, 5].map((n) => joker(n, n === 5 ? 'ample' : undefined)));
    await render(<ConnectedShop />);
    const offer = useGame.getState().run!.shop.findIndex((o) => o.kind === 'joker');
    let error: unknown = 'unset';
    await act(async () => {
      error = useGame.getState().buy(offer);
    });
    expect(error).toBeNull();
    expect(useGame.getState().run!.jokers).toHaveLength(6);
  });
});

describe('buying an offer that brings its own slot', () => {
  const withOffer = (edition: string) => {
    reachShop([1, 2, 3, 4, 5].map((n) => joker(n)));
    const run = useGame.getState().run!;
    useGame.setState({
      run: {
        ...run,
        nextJokerNumber: 6,
        shop: [
          { kind: 'joker', jokerId: 'minimalist', price: 6, sold: false, edition },
          ...run.shop.slice(1),
        ],
      },
    });
  };

  it('an ample offer is not marked as full and can be bought at 5/5', async () => {
    withOffer('ample');
    await render(<ConnectedShop />);
    expect(within(screen.getByTestId('offer-0')).queryByText(es.shop.full)).toBeNull();
    let error: unknown = 'unset';
    await act(async () => {
      error = useGame.getState().buy(0);
    });
    expect(error).toBeNull();
    expect(useGame.getState().run!.jokers).toHaveLength(6);
  });

  it('any other edition is still marked as full at 5/5', async () => {
    withOffer('foil');
    await render(<ConnectedShop />);
    expect(within(screen.getByTestId('offer-0')).getByText(es.shop.full)).toBeTruthy();
  });
});
