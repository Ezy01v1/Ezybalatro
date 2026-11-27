import { DEFAULT_RUN_CONFIG, type OpenPack, type RunConfig, type RunState } from '@naipes/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ShopScreen } from '@/components/roguelike/ShopScreen';
import { useGame } from '@/game/store';
import { CONSUMABLE_TEXTS, es, JOKER_TEXTS, RANK_NAMES, SUIT_NAMES } from '@/i18n/es';

const EASY: RunConfig = {
  ...DEFAULT_RUN_CONFIG,
  anteTargets: [1, 1, 1, 1, 1, 1, 1, 1],
  startingMoney: 50,
};

function ConnectedShop() {
  const run = useGame((s) => s.run);
  return run ? <ShopScreen run={run} /> : null;
}

/** A run in the shop whose open pack is the given one (as if bought, or loaded from a save). */
function reachShopWithPack(openPack: OpenPack, patch: Partial<RunState> = {}): RunState {
  useGame.getState().startRun('PACK-SHEET', EASY);
  useGame.getState().toggleCard(useGame.getState().run!.hand[0]!.id);
  useGame.getState().play();
  useGame.getState().finishPlayback();
  useGame.getState().dismissRoundSummary();
  const run: RunState = { ...useGame.getState().run!, ...patch, openPack };
  useGame.setState({ run });
  return run;
}

const jokerPack = (picksLeft = 1): OpenPack => ({
  packId: 'pack_joker',
  picksLeft,
  items: [
    { kind: 'joker', jokerId: 'tip_jar', taken: false },
    { kind: 'joker', jokerId: 'figurine', taken: false },
    { kind: 'joker', jokerId: 'saver', taken: false },
  ],
});

const press = async (testID: string) => {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  useGame.getState().exitRun();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the pack sheet', () => {
  it('shows the open pack with its options, the pick counter and the skip button', async () => {
    reachShopWithPack(jokerPack());
    await render(<ConnectedShop />);
    expect(screen.getByTestId('pack-sheet')).toBeTruthy();
    expect(screen.getByText(es.packs.pick(1, 1))).toBeTruthy();
    for (const i of [0, 1, 2]) expect(screen.getByTestId(`pack-item-${i}`)).toBeTruthy();
    expect(screen.getByText(JOKER_TEXTS.tip_jar!.name)).toBeTruthy();
    expect(screen.getByTestId('pack-skip')).toBeTruthy();
    expect(screen.getByTestId('pack-error')).toBeTruthy();
  });

  it('each option announces its name and description and invites to pick it', async () => {
    reachShopWithPack(jokerPack());
    await render(<ConnectedShop />);
    const item = screen.getByTestId('pack-item-0');
    expect(item.props.accessibilityLabel).toContain(JOKER_TEXTS.tip_jar!.name);
    expect(item.props.accessibilityLabel).toContain(JOKER_TEXTS.tip_jar!.description);
    expect(item.props.accessibilityHint).toBe(es.packs.pickHint);
  });

  it('has no way to dismiss it: the backdrop is not a "Cerrar" button', async () => {
    reachShopWithPack(jokerPack());
    await render(<ConnectedShop />);
    expect(screen.queryByLabelText(es.game.close)).toBeNull();
  });

  it('picking a joker adds it, closes the sheet and says what was added', async () => {
    reachShopWithPack(jokerPack());
    await render(<ConnectedShop />);
    await press('pack-item-0');
    const run = useGame.getState().run!;
    expect(run.jokers.map((j) => j.jokerId)).toEqual(['tip_jar']);
    expect(run.openPack).toBeNull();
    expect(screen.queryByTestId('pack-sheet')).toBeNull();
    expect(screen.getByText(es.packs.added(JOKER_TEXTS.tip_jar!.name))).toBeTruthy();
  });

  it('picking a consumable puts it in the inventory', async () => {
    reachShopWithPack({
      packId: 'pack_consumable',
      picksLeft: 1,
      items: [
        { kind: 'consumable', consumableId: 'study_pair', taken: false },
        { kind: 'consumable', consumableId: 'twin', taken: false },
      ],
    });
    await render(<ConnectedShop />);
    expect(screen.getByText(CONSUMABLE_TEXTS.twin!.name)).toBeTruthy();
    await press('pack-item-1');
    expect(useGame.getState().run!.consumables.map((c) => c.consumableId)).toEqual(['twin']);
  });

  it('with several picks, marks the taken option and keeps the sheet open', async () => {
    reachShopWithPack(jokerPack(2));
    await render(<ConnectedShop />);
    expect(screen.getByText(es.packs.pick(2, 2))).toBeTruthy();
    await press('pack-item-0');
    expect(screen.getByTestId('pack-sheet')).toBeTruthy();
    expect(screen.getByText(es.packs.pick(2, 1))).toBeTruthy();
    expect(screen.getByText(es.packs.taken)).toBeTruthy();
    expect(screen.getByTestId('pack-item-0').props.accessibilityState).toMatchObject({
      disabled: true,
      selected: true,
    });
    await press('pack-item-0');
    expect(useGame.getState().run!.jokers).toHaveLength(1);
  });

  it('skipping without having picked asks twice, then closes without taking anything', async () => {
    reachShopWithPack(jokerPack());
    await render(<ConnectedShop />);
    expect(screen.getByText(es.packs.skip)).toBeTruthy();
    await press('pack-skip');
    expect(screen.getByText(es.packs.skipConfirm)).toBeTruthy();
    expect(useGame.getState().run!.openPack).not.toBeNull();
    await press('pack-skip');
    expect(useGame.getState().run!.openPack).toBeNull();
    expect(useGame.getState().run!.jokers).toEqual([]);
  });

  it('skips the rest at the first tap once something was picked', async () => {
    reachShopWithPack(jokerPack(2));
    await render(<ConnectedShop />);
    await press('pack-item-0');
    expect(screen.getByText(es.packs.skipRest)).toBeTruthy();
    await press('pack-skip');
    expect(useGame.getState().run!.openPack).toBeNull();
    expect(useGame.getState().run!.jokers).toHaveLength(1);
  });

  it('without a free slot says so, keeps the sheet open and changes nothing', async () => {
    const run = reachShopWithPack(jokerPack(), { config: { ...EASY, jokerSlots: 0 } });
    await render(<ConnectedShop />);
    await press('pack-item-0');
    expect(screen.getByTestId('pack-error')).toHaveTextContent(es.packs.errors.noJokerSlot);
    expect(screen.getByTestId('pack-error').props.accessibilityLiveRegion).toBe('assertive');
    expect(screen.getByTestId('pack-sheet')).toBeTruthy();
    expect(useGame.getState().run!.openPack).toEqual(run.openPack);
    expect(useGame.getState().run!.jokers).toEqual([]);
  });

  it('shows a card option as its face and adds it to the deck when picked', async () => {
    reachShopWithPack({
      packId: 'pack_card',
      picksLeft: 1,
      items: [
        { kind: 'card', suit: 'h', rank: 13, enhancement: 'reinforced' },
        { kind: 'card', suit: 's', rank: 14, enhancement: 'charged' },
      ].map((item) => ({ ...item, taken: false })) as OpenPack['items'],
    });
    await render(<ConnectedShop />);
    expect(screen.getByText(es.packs.cardNote)).toBeTruthy();
    expect(screen.getByText(es.packs.cardItem(RANK_NAMES[13], SUIT_NAMES.h))).toBeTruthy();
    const before = useGame.getState().run!.deck.length;
    await press('pack-item-0');
    const deck = useGame.getState().run!.deck;
    expect(deck).toHaveLength(before + 1);
    expect(deck[deck.length - 1]).toMatchObject({ suit: 'h', rank: 13, enhancement: 'reinforced' });
  });

  it('is shown again when the shop mounts with a pack that was left open', async () => {
    reachShopWithPack({
      ...jokerPack(1),
      items: jokerPack(1).items.map((i, n) => ({ ...i, taken: n === 0 })),
    });
    await render(<ConnectedShop />);
    expect(screen.getByTestId('pack-sheet')).toBeTruthy();
    expect(screen.getByText(es.packs.pick(2, 1))).toBeTruthy();
    expect(screen.getByText(es.packs.taken)).toBeTruthy();
  });
});
