import {
  DEFAULT_RUN_CONFIG,
  jokerSellValue,
  type JokerInstance,
  type RunConfig,
} from '@naipes/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { JokerDetailSheet } from '@/components/roguelike/JokerDetailSheet';
import { JokerRail } from '@/components/roguelike/JokerRail';
import { ShopScreen } from '@/components/roguelike/ShopScreen';
import { useGame } from '@/game/store';
import { EDITION_TEXTS, es, JOKER_TEXTS } from '@/i18n/es';

const EASY: RunConfig = {
  ...DEFAULT_RUN_CONFIG,
  anteTargets: [1, 1, 1, 1, 1, 1, 1, 1],
  startingMoney: 50,
  editionOneIn: 0,
};

const ember = (edition?: string): JokerInstance => ({
  instanceId: 'j1',
  jokerId: 'ember',
  state: {},
  ...(edition ? { edition } : {}),
});

function ConnectedShop() {
  const run = useGame((s) => s.run);
  return run ? <ShopScreen run={run} /> : null;
}

function reachShop(
  patch: (run: NonNullable<ReturnType<typeof useGame.getState>['run']>) => object,
) {
  useGame.getState().startRun('EDITIONS', EASY);
  useGame.getState().toggleCard(useGame.getState().run!.hand[0]!.id);
  useGame.getState().play();
  useGame.getState().finishPlayback();
  useGame.getState().dismissRoundSummary();
  const run = useGame.getState().run!;
  useGame.setState({ run: { ...run, ...patch(run) } });
}

beforeEach(() => {
  jest.useFakeTimers();
  useGame.getState().exitRun();
});
afterEach(() => jest.useRealTimers());

describe('the rail', () => {
  it('shows the edition label on an edited joker and says it to screen readers', async () => {
    await render(<JokerRail jokers={[ember('foil')]} slots={5} />);
    expect(screen.getByTestId('joker-edition-j1')).toBeTruthy();
    expect(screen.getByText(EDITION_TEXTS.foil!.short)).toBeTruthy();
    const label = screen.getByTestId('joker-j1').props.accessibilityLabel as string;
    expect(label).toContain(EDITION_TEXTS.foil!.name);
    expect(label).toContain(JOKER_TEXTS.ember!.name);
  });

  it('shows nothing extra on a joker without edition', async () => {
    await render(<JokerRail jokers={[ember()]} slots={5} />);
    expect(screen.queryByTestId('joker-edition-j1')).toBeNull();
    expect(screen.getByTestId('joker-j1').props.accessibilityLabel).not.toContain(
      es.editions.label,
    );
  });
});

describe('the joker detail sheet', () => {
  it('has an edition line with its name and what it does', async () => {
    await render(<JokerDetailSheet joker={ember('holo')} onClose={() => {}} />);
    const holo = EDITION_TEXTS.holo!;
    expect(screen.getByTestId('joker-detail-edition')).toHaveTextContent(
      es.editions.detail(holo.name, holo.description),
    );
  });

  it('has no edition line for a plain joker', async () => {
    await render(<JokerDetailSheet joker={ember()} onClose={() => {}} />);
    expect(screen.queryByTestId('joker-detail-edition')).toBeNull();
  });
});

describe('the shop', () => {
  it('names the edition on an edited offer and charges the price in the offer', async () => {
    reachShop((run) => ({
      shop: [
        { kind: 'joker', jokerId: 'ember', price: 6, sold: false, edition: 'foil' },
        ...run.shop.slice(1),
      ],
    }));
    await render(<ConnectedShop />);
    const foil = EDITION_TEXTS.foil!;
    expect(screen.getByTestId('offer-edition-0')).toHaveTextContent(
      es.editions.detail(foil.name, foil.description),
    );
    expect(screen.getByTestId('buy-0')).toHaveTextContent(es.shop.buy(6));
  });

  it('a plain offer has no edition line', async () => {
    reachShop(() => ({}));
    await render(<ConnectedShop />);
    expect(screen.queryByTestId('offer-edition-0')).toBeNull();
  });

  it('selling an edited joker shows the value that includes the surcharge', async () => {
    const edited = ember('poly');
    reachShop(() => ({ jokers: [edited] }));
    await render(<ConnectedShop />);
    await act(async () => {
      fireGestureHandler(getByGestureTestId('joker-tap-j1'), [
        { state: State.BEGAN },
        { state: State.ACTIVE },
        { state: State.END },
      ]);
      jest.runAllTicks();
    });
    expect(screen.getByTestId('sell-button')).toHaveTextContent(
      es.shop.sell(jokerSellValue(edited)),
    );
    expect(jokerSellValue(edited)).toBeGreaterThan(jokerSellValue(ember()));
    await fireEvent.press(screen.getByTestId('sell-button'));
    expect(screen.getByTestId('sell-button')).toHaveTextContent(
      es.shop.sellConfirm(jokerSellValue(edited)),
    );
  });
});
