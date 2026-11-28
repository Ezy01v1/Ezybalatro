import {
  consumableSellValue,
  DEFAULT_RUN_CONFIG,
  JOKERS,
  type RunConfig,
  type RunState,
  type ShopOffer,
} from '@naipes/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { BackHandler } from 'react-native';
import { GameScreen } from '@/components/roguelike/GameScreen';
import { ShopScreen } from '@/components/roguelike/ShopScreen';
import { useGame } from '@/game/store';
import { CONSUMABLE_TEXTS } from '@/i18n/es';

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

/** Puts the given consumables in the inventory (instance ids c1, c2…) of the current run. */
function giveConsumables(...ids: string[]) {
  const run = useGame.getState().run!;
  useGame.setState({
    run: {
      ...run,
      consumables: ids.map((consumableId, i) => ({ instanceId: `c${i + 1}`, consumableId })),
    },
  });
}

function startBlind(...consumables: string[]) {
  useGame.getState().startRun('CONSUMABLE-UI');
  giveConsumables(...consumables);
}

function reachShop(offers: ShopOffer[], ...consumables: string[]) {
  useGame.getState().startRun('CONSUMABLE-SHOP', EASY);
  useGame.getState().toggleCard(useGame.getState().run!.hand[0]!.id);
  useGame.getState().play();
  useGame.getState().finishPlayback();
  useGame.getState().dismissRoundSummary();
  expect(useGame.getState().run!.phase).toBe('shop');
  const run: RunState = useGame.getState().run!;
  useGame.setState({
    run: {
      ...run,
      shop: offers,
      money: 30,
      consumables: consumables.map((consumableId, i) => ({
        instanceId: `c${i + 1}`,
        consumableId,
      })),
    },
  });
}

const offer = (consumableId: string, price = 3): ShopOffer => ({
  kind: 'consumable',
  consumableId,
  price,
  sold: false,
});

/** `toHaveTextContent` with a string needs the whole text: this matches a part of it. */
const contains = (text: string) => new RegExp(text.replace(/[$^.*+?()[\]{}|\\]/g, '\\$&'));

/**
 * A screen reader merges everything inside an `accessible` node into that node's own label, so
 * text there is only announced if it is in the label. This is true when no ancestor merges it.
 */
const isSeparatelyAnnounced = (element: ReturnType<typeof screen.getByTestId>) => {
  for (let node = element.parent; node; node = node.parent)
    if (typeof node.type === 'string' && node.props.accessible === true) return false;
  return true;
};

const press = async (testID: string) => fireEvent.press(screen.getByTestId(testID));
const inactive = (testID: string) =>
  screen.getByTestId(testID).props.accessibilityState.disabled === true;

beforeEach(() => {
  jest.useFakeTimers();
  useGame.getState().exitRun();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('shop: consumable offers', () => {
  it('shows consumable offers under their own section with name and description', async () => {
    reachShop([offer('paint_h'), offer('study_pair')]);
    await render(<ConnectedShop />);
    expect(screen.getByText('Consumibles')).toBeTruthy();
    const card = screen.getByTestId('offer-0');
    expect(card).toHaveTextContent(contains(CONSUMABLE_TEXTS.paint_h!.name));
    expect(card).toHaveTextContent(contains(CONSUMABLE_TEXTS.paint_h!.description));
    expect(card).toHaveTextContent(contains('Se usa durante una ciega'));
    expect(screen.getByTestId('offer-1')).toHaveTextContent(
      contains('Se usa en la tienda o en una ciega'),
    );
  });

  it('keeps the run.shop index in the test ids when jokers and consumables are mixed', async () => {
    reachShop([
      offer('study_pair'),
      { kind: 'joker', jokerId: JOKERS[0]!.id, price: 4, sold: false },
    ]);
    await render(<ConnectedShop />);
    expect(screen.getByText('Comodines', { exact: true })).toBeTruthy();
    expect(screen.getByTestId('offer-0')).toHaveTextContent(contains('Estudio: Par'));
    // Buying the joker (listed first on screen, index 1 in run.shop) uses its run.shop index.
    await press('buy-1');
    expect(useGame.getState().run!.jokers).toHaveLength(1);
    expect(useGame.getState().run!.shop[1]!.sold).toBe(true);
    expect(useGame.getState().run!.shop[0]!.sold).toBe(false);
  });

  it('buying a consumable fills slot 1 of the wide tray and spends the money', async () => {
    reachShop([offer('paint_h')]);
    await render(<ConnectedShop />);
    expect(screen.getByTestId('consumable-slot-1')).toHaveTextContent(contains('Espacio libre'));
    await press('buy-0');
    expect(useGame.getState().run!.money).toBe(27);
    expect(useGame.getState().run!.consumables.map((c) => c.consumableId)).toEqual(['paint_h']);
    expect(screen.getByTestId('consumable-slot-1')).toHaveTextContent(
      contains('Tinta de Corazones'),
    );
    expect(screen.getByTestId('consumable-slot-2')).toHaveTextContent(contains('Espacio libre'));
    expect(screen.getByTestId('offer-0')).toHaveTextContent(contains('Comprado'));
  });

  it('with every slot full the offer says so and cannot be bought', async () => {
    reachShop([offer('paint_h')], 'twin', 'scrap');
    await render(<ConnectedShop />);
    expect(screen.getByTestId('offer-0')).toHaveTextContent(contains('Espacios llenos'));
    expect(inactive('buy-0')).toBe(true);
    await press('buy-0');
    expect(useGame.getState().run!.consumables).toHaveLength(2);
    expect(useGame.getState().run!.money).toBe(30);
  });

  it('a purchase the engine refuses for lack of space shows a notice', async () => {
    reachShop([offer('paint_h')]);
    await render(<ConnectedShop />);
    // The screen shows a free slot while the engine says there is none: the engine has the last word.
    const realBuy = useGame.getState().buy;
    await act(async () => useGame.setState({ buy: () => 'NO_CONSUMABLE_SLOT' }));
    try {
      await press('buy-0');
      expect(screen.getByTestId('notice')).toHaveTextContent(
        contains('No hay espacio para otro consumible'),
      );
    } finally {
      await act(async () => useGame.setState({ buy: realBuy }));
    }
  });
});

describe('shop: using and selling consumables', () => {
  it('a study can be used in the shop: raises the level and shows a notice', async () => {
    reachShop([], 'study_pair');
    const before = useGame.getState().run!.handLevels.pair;
    await render(<ConnectedShop />);
    await press('consumable-slot-1');
    expect(screen.getByTestId('consumable-detail')).toBeTruthy();
    expect(inactive('consumable-use')).toBe(false);
    await press('consumable-use');

    expect(useGame.getState().run!.handLevels.pair).toBe(before + 1);
    expect(useGame.getState().run!.consumables).toHaveLength(0);
    expect(screen.queryByTestId('consumable-detail')).toBeNull();
    expect(screen.getByTestId('notice')).toHaveTextContent(
      contains(`Par sube al nivel ${before + 1}`),
    );
    expect(screen.getByTestId('consumable-slot-1')).toHaveTextContent(contains('Espacio libre'));
  });

  it('a consumable that needs cards is inactive in the shop and says why', async () => {
    reachShop([], 'paint_h');
    await render(<ConnectedShop />);
    await press('consumable-slot-1');
    expect(inactive('consumable-use')).toBe(true);
    expect(screen.getByTestId('consumable-use-reason')).toHaveTextContent(
      'Úsalo durante una ciega',
    );
    await press('consumable-use');
    expect(useGame.getState().targeting).toBeNull();
    expect(useGame.getState().run!.consumables).toHaveLength(1);
    expect(screen.getByTestId('consumable-detail')).toBeTruthy();
  });

  it('selling needs two taps, pays the sell value and closing disarms it', async () => {
    reachShop([], 'paint_h', 'twin');
    const run = useGame.getState().run!;
    const value = consumableSellValue(run.consumables[0]!);
    await render(<ConnectedShop />);
    await press('consumable-slot-1');
    expect(screen.getByTestId('consumable-sell')).toHaveTextContent(contains(`Vender $${value}`));

    // First tap arms; closing the sheet disarms.
    await press('consumable-sell');
    expect(screen.getByTestId('consumable-sell')).toHaveTextContent(
      contains(`Confirmar venta $${value}`),
    );
    expect(useGame.getState().run!.consumables).toHaveLength(2);
    await fireEvent.press(screen.getByText('Cerrar'));
    await press('consumable-slot-1');
    expect(screen.getByTestId('consumable-sell')).toHaveTextContent(contains(`Vender $${value}`));

    await press('consumable-sell');
    await press('consumable-sell');
    const after = useGame.getState().run!;
    expect(after.money).toBe(run.money + value);
    expect(after.consumables.map((c) => c.instanceId)).toEqual(['c2']);
    expect(screen.getByTestId('notice')).toHaveTextContent(contains(`Vendido por $${value}`));
  });
});

describe('blind: card-picking mode', () => {
  const useFirst = async () => {
    await press('consumable-slot-1');
    await press('consumable-use');
  };

  it('enters the mode: Play/Discard bar is gone, the targeting bar shows Aplicar 0/3 inactive', async () => {
    startBlind('paint_h');
    await render(<ConnectedGame />);
    expect(screen.getByTestId('play-button')).toBeTruthy();
    await useFirst();

    expect(useGame.getState().targeting).toEqual({ instanceId: 'c1' });
    expect(screen.queryByTestId('play-button')).toBeNull();
    expect(screen.queryByTestId('discard-button')).toBeNull();
    expect(screen.queryByTestId('hand-preview')).toBeNull();
    expect(screen.getByTestId('targeting-panel')).toHaveTextContent(contains('Tinta de Corazones'));
    expect(screen.getByTestId('targeting-hint')).toHaveTextContent(
      contains('Elige hasta 3 cartas'),
    );
    expect(screen.getByTestId('targeting-apply')).toHaveTextContent(contains('Aplicar'));
    expect(screen.getByTestId('targeting-apply')).toHaveTextContent(contains('0/3'));
    expect(inactive('targeting-apply')).toBe(true);
    expect(screen.queryByTestId('consumable-detail')).toBeNull();
  });

  it('choosing cards updates the counter and the 4th card is refused with a hint', async () => {
    startBlind('paint_h');
    await render(<ConnectedGame />);
    await useFirst();
    const hand = useGame.getState().run!.hand;
    await press(`card-${hand[0]!.id}`);
    expect(screen.getByTestId('targeting-apply')).toHaveTextContent(contains('1/3'));
    expect(inactive('targeting-apply')).toBe(false);
    await press(`card-${hand[1]!.id}`);
    await press(`card-${hand[2]!.id}`);
    expect(screen.getByTestId('targeting-apply')).toHaveTextContent(contains('3/3'));
    await press(`card-${hand[3]!.id}`);
    expect(useGame.getState().selected).toHaveLength(3);
    expect(screen.getByTestId('targeting-hint')).toHaveTextContent(
      contains('Solo puedes elegir 3'),
    );
    // The live region must not be swallowed by an accessible parent, or TalkBack never says it.
    expect(isSeparatelyAnnounced(screen.getByTestId('targeting-hint'))).toBe(true);
    expect(screen.getByTestId('targeting-hint').props.accessibilityLiveRegion).toBe('polite');

    // The hint goes back to the instruction after a moment.
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByTestId('targeting-hint')).toHaveTextContent(
      contains('Elige hasta 3 cartas'),
    );
  });

  it('Aplicar changes the suit shown in the hand and leaves the mode', async () => {
    startBlind('paint_h');
    await render(<ConnectedGame />);
    await useFirst();
    const target = useGame.getState().run!.hand.find((c) => c.suit !== 'h')!;
    expect(screen.getByTestId(`card-${target.id}`).props.accessibilityLabel).not.toContain(
      'corazones',
    );
    await press(`card-${target.id}`);
    await press('targeting-apply');

    expect(useGame.getState().targeting).toBeNull();
    expect(useGame.getState().run!.consumables).toHaveLength(0);
    expect(screen.getByTestId(`card-${target.id}`).props.accessibilityLabel).toContain('corazones');
    expect(screen.queryByTestId('targeting-bar')).toBeNull();
    expect(screen.getByTestId('play-button')).toBeTruthy();
    expect(screen.getByTestId('consumable-slot-1')).toHaveTextContent(contains('Vacío'));
  });

  it('Cancelar leaves the mode without changes', async () => {
    startBlind('paint_h');
    await render(<ConnectedGame />);
    await useFirst();
    const before = useGame.getState().run!;
    await press(`card-${before.hand[0]!.id}`);
    await press('targeting-cancel');
    expect(useGame.getState().targeting).toBeNull();
    expect(useGame.getState().selected).toEqual([]);
    expect(useGame.getState().run).toBe(before);
    expect(screen.queryByTestId('targeting-bar')).toBeNull();
    expect(screen.getByTestId('play-button')).toBeTruthy();
  });

  it('the Android Back button cancels the mode', async () => {
    let onBack: (() => boolean) | undefined;
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      onBack = handler as unknown as () => boolean;
      return { remove: () => (onBack = undefined) };
    });
    startBlind('paint_h');
    await render(<ConnectedGame />);
    expect(onBack).toBeUndefined();
    await useFirst();
    expect(onBack).toBeDefined();
    let handled = false;
    await act(async () => {
      handled = onBack!();
    });
    expect(handled).toBe(true);
    expect(useGame.getState().targeting).toBeNull();
    expect(onBack).toBeUndefined();
  });

  it('while picking, the other slot and the tray do not respond', async () => {
    startBlind('paint_h', 'twin');
    await render(<ConnectedGame />);
    await useFirst();
    await press('consumable-slot-2');
    expect(screen.queryByTestId('consumable-detail')).toBeNull();
    await press('consumable-slot-1');
    expect(screen.queryByTestId('consumable-detail')).toBeNull();
    expect(screen.getByTestId('consumable-slot-2').props.accessibilityState.disabled).toBe(true);
  });

  it('shows the engine error, keeps the selection and clears it when the selection changes', async () => {
    startBlind('elevate');
    const start = useGame.getState().run!;
    const withAce = { ...start.hand[0]!, rank: 14 as const };
    useGame.setState({ run: { ...start, hand: [withAce, ...start.hand.slice(1)] } });
    await render(<ConnectedGame />);
    await useFirst();
    await press(`card-${withAce.id}`);
    await press('targeting-apply');
    expect(screen.getByTestId('targeting-hint')).toHaveTextContent(
      contains('El As ya no puede subir.'),
    );
    expect(isSeparatelyAnnounced(screen.getByTestId('targeting-hint'))).toBe(true);
    expect(screen.getByTestId('targeting-hint').props.accessibilityLiveRegion).toBe('polite');
    // The panel still tells the screen reader what is being used and how many cards are chosen.
    expect(screen.getByLabelText(contains('Usando Ascenso, 1 de 2 cartas elegidas'))).toBeTruthy();
    expect(useGame.getState().targeting).toEqual({ instanceId: 'c1' });
    expect(useGame.getState().selected).toEqual([withAce.id]);
    expect(useGame.getState().run!.consumables).toHaveLength(1);

    await press(`card-${withAce.id}`);
    expect(screen.getByTestId('targeting-hint')).toHaveTextContent(
      contains('Elige hasta 2 cartas'),
    );
  });

  it('scrap needs two taps on Aplicar; changing the selection disarms', async () => {
    startBlind('scrap');
    await render(<ConnectedGame />);
    await useFirst();
    expect(screen.getByTestId('targeting-panel')).toHaveTextContent(
      contains('Se destruyen para siempre.'),
    );
    const hand = useGame.getState().run!.hand;
    const decks = useGame.getState().run!.deck.length;
    await press(`card-${hand[0]!.id}`);
    await press('targeting-apply');
    expect(screen.getByTestId('targeting-apply')).toHaveTextContent(
      contains('Confirmar: destruir'),
    );
    expect(useGame.getState().run!.deck).toHaveLength(decks);

    // Changing the selection disarms.
    await press(`card-${hand[1]!.id}`);
    expect(screen.getByTestId('targeting-apply')).toHaveTextContent(contains('Aplicar'));
    await press('targeting-apply');
    expect(screen.getByTestId('targeting-apply')).toHaveTextContent(
      contains('Confirmar: destruir'),
    );
    expect(useGame.getState().run!.deck).toHaveLength(decks);

    // It also disarms by itself.
    await act(async () => {
      jest.advanceTimersByTime(3100);
    });
    expect(screen.getByTestId('targeting-apply')).toHaveTextContent(contains('Aplicar'));

    await press('targeting-apply');
    await press('targeting-apply');
    expect(useGame.getState().run!.deck).toHaveLength(decks - 2);
    expect(useGame.getState().targeting).toBeNull();
  });

  it('refuses a scrap that would leave the hand empty, with its own message', async () => {
    startBlind('scrap');
    const start = useGame.getState().run!;
    const hand = start.hand.slice(0, 2);
    useGame.setState({ run: { ...start, drawPile: [], hand } });
    await render(<ConnectedGame />);
    await useFirst();
    await press(`card-${hand[0]!.id}`);
    await press(`card-${hand[1]!.id}`);
    await press('targeting-apply');
    await press('targeting-apply');
    expect(screen.getByTestId('targeting-hint')).toHaveTextContent(
      contains('Te quedarías sin cartas en la mano.'),
    );
    expect(useGame.getState().run!.consumables).toHaveLength(1);
    expect(useGame.getState().run!.hand).toHaveLength(2);
  });

  it('a consumable without destroy applies with one tap', async () => {
    startBlind('reinforce');
    await render(<ConnectedGame />);
    await useFirst();
    expect(screen.getByTestId('targeting-panel')).not.toHaveTextContent(contains('destruyen'));
    await press(`card-${useGame.getState().run!.hand[0]!.id}`);
    await press('targeting-apply');
    expect(useGame.getState().run!.consumables).toHaveLength(0);
  });

  it('a study in a blind is used right away from the sheet, with a notice', async () => {
    startBlind('study_pair');
    const before = useGame.getState().run!.handLevels.pair;
    await render(<ConnectedGame />);
    await useFirst();
    expect(useGame.getState().targeting).toBeNull();
    expect(useGame.getState().run!.handLevels.pair).toBe(before + 1);
    expect(screen.getByTestId('notice')).toHaveTextContent(
      contains(`Par sube al nivel ${before + 1}`),
    );
  });
});

describe('blind: the tray while a hand is being scored', () => {
  it('does not open the sheet and is marked disabled', async () => {
    startBlind('paint_h');
    await render(<ConnectedGame />);
    await press(`card-${useGame.getState().run!.hand[0]!.id}`);
    await press('play-button');
    expect(useGame.getState().playback).not.toBeNull();
    expect(screen.getByTestId('consumable-slot-1').props.accessibilityState.disabled).toBe(true);
    await press('consumable-slot-1');
    expect(screen.queryByTestId('consumable-detail')).toBeNull();
  });
});
