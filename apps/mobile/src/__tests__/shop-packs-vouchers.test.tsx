import { DEFAULT_CONTENT, DEFAULT_RUN_CONFIG, type RunConfig, type RunState } from '@naipes/engine';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { ShopScreen } from '@/components/roguelike/ShopScreen';
import { useGame } from '@/game/store';
import { es, PACK_TEXTS, VOUCHER_TEXTS } from '@/i18n/es';

/** Any single card beats every blind: lets the tests reach the shop deterministically. */
const EASY: RunConfig = {
  ...DEFAULT_RUN_CONFIG,
  anteTargets: [1, 1, 1, 1, 1, 1, 1, 1],
  startingMoney: 50,
};

function ConnectedShop() {
  const run = useGame((s) => s.run);
  return run ? <ShopScreen run={run} /> : null;
}

/** The real shop of a seed (7 offers: 2 jokers, 2 consumables, 2 packs, 1 voucher), money 50. */
function reachShop(config: RunConfig = EASY): RunState {
  useGame.getState().startRun('SHOP-PACKS', config);
  useGame.getState().toggleCard(useGame.getState().run!.hand[0]!.id);
  useGame.getState().play();
  useGame.getState().finishPlayback();
  useGame.getState().dismissRoundSummary();
  const run = useGame.getState().run!;
  expect(run.phase).toBe('shop');
  return run;
}

const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));
const isInactive = (testID: string) =>
  screen.getByTestId(testID).props.accessibilityState.disabled === true;

beforeEach(() => {
  jest.useFakeTimers();
  useGame.getState().exitRun();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the shop with packs and vouchers', () => {
  it('shows the pack and voucher sections with their rows and prices', async () => {
    const run = reachShop();
    await render(<ConnectedShop />);
    expect(screen.getByText(es.shop.packs)).toBeTruthy();
    expect(screen.getByText(es.shop.voucher)).toBeTruthy();
    run.shop.forEach((offer, index) => {
      expect(screen.getByTestId(`offer-${index}`)).toBeTruthy();
      expect(screen.getByTestId(`buy-${index}`)).toBeTruthy();
      if (offer.kind === 'pack')
        expect(screen.getAllByText(PACK_TEXTS[offer.packId]!.name).length).toBeGreaterThan(0);
      if (offer.kind === 'voucher')
        expect(screen.getAllByText(VOUCHER_TEXTS[offer.voucherId]!.name).length).toBeGreaterThan(0);
    });
    // The first offer keeps its place: the Maestro flow buys it by position.
    expect(run.shop[0]!.kind).toBe('joker');
  });

  it('tells how many options and picks a pack has', async () => {
    const run = reachShop();
    await render(<ConnectedShop />);
    const pack = run.shop.find((o) => o.kind === 'pack')!;
    const def = DEFAULT_CONTENT.packs.find((p) => pack.kind === 'pack' && p.id === pack.packId)!;
    expect(screen.getAllByText(es.shop.packPick(def.size, def.picks)).length).toBeGreaterThan(0);
  });

  it('Renovar sits under the consumables and says what it changes', async () => {
    reachShop();
    await render(<ConnectedShop />);
    expect(screen.getByText(es.shop.rerollScope)).toBeTruthy();
    expect(screen.getByTestId('reroll-button')).toBeTruthy();
  });

  it('buying a pack opens it in the run and marks the row as bought', async () => {
    const run = reachShop();
    const index = run.shop.findIndex((o) => o.kind === 'pack');
    await render(<ConnectedShop />);
    await act(async () => press(`buy-${index}`));
    expect(useGame.getState().run!.openPack).not.toBeNull();
    expect(useGame.getState().run!.shop[index]).toMatchObject({ sold: true });
  });

  it('buying the voucher changes the rules, says so and lists it under "Tus vales"', async () => {
    const run = reachShop();
    const index = run.shop.findIndex((o) => o.kind === 'voucher');
    const offer = run.shop[index]!;
    const id = offer.kind === 'voucher' ? offer.voucherId : '';
    await render(<ConnectedShop />);
    expect(screen.queryByTestId('vouchers-owned')).toBeNull();
    await act(async () => press(`buy-${index}`));
    expect(useGame.getState().run!.vouchers).toEqual([id]);
    expect(screen.getByTestId('vouchers-owned')).toBeTruthy();
    expect(screen.getByTestId(`voucher-pill-${id}`)).toHaveTextContent(VOUCHER_TEXTS[id]!.short);
    expect(screen.getByText(es.shop.voucherBought(VOUCHER_TEXTS[id]!.short))).toBeTruthy();
    expect(screen.getByText(es.shop.vouchersOwned(1))).toBeTruthy();
  });

  it('a row says "Te faltan" and does not buy when money is short', async () => {
    const run = reachShop();
    const index = run.shop.findIndex((o) => o.kind === 'voucher');
    const price = run.shop[index]!.price;
    useGame.setState({ run: { ...useGame.getState().run!, money: price - 1 } });
    await render(<ConnectedShop />);
    expect(within(screen.getByTestId(`offer-${index}`)).getByText(es.shop.missing(1))).toBeTruthy();
    expect(isInactive(`buy-${index}`)).toBe(true);
    await act(async () => press(`buy-${index}`));
    expect(useGame.getState().run!.vouchers).toEqual([]);
  });

  it('a joker pack with no free joker slot says so and does not buy', async () => {
    const run = reachShop({ ...EASY, jokerSlots: 0 });
    const index = run.shop.findIndex(
      (o) =>
        o.kind === 'pack' && DEFAULT_CONTENT.packs.find((p) => p.id === o.packId)?.kind === 'joker',
    );
    // Not every seed offers the joker pack: force it into the shop.
    const forced: RunState = {
      ...run,
      shop: run.shop.map((o, i) =>
        i === (index === -1 ? run.shop.findIndex((x) => x.kind === 'pack') : index)
          ? { kind: 'pack', packId: 'pack_joker', price: 6, sold: false }
          : o,
      ),
    };
    useGame.setState({ run: forced });
    await render(<ConnectedShop />);
    const at = forced.shop.findIndex((o) => o.kind === 'pack' && o.packId === 'pack_joker');
    expect(screen.getByText(es.shop.noJokerSlot)).toBeTruthy();
    expect(isInactive(`buy-${at}`)).toBe(true);
    await act(async () => press(`buy-${at}`));
    expect(useGame.getState().run!.openPack).toBeNull();
  });

  it('a bought row shows "Comprado" and its button stays inactive', async () => {
    const run = reachShop();
    const index = run.shop.findIndex((o) => o.kind === 'voucher');
    await render(<ConnectedShop />);
    await act(async () => press(`buy-${index}`));
    expect(screen.getAllByText(es.shop.bought).length).toBeGreaterThan(0);
    expect(isInactive(`buy-${index}`)).toBe(true);
  });

  it('shows no voucher section once the catalog is exhausted', async () => {
    const run = reachShop();
    useGame.setState({
      run: { ...run, shop: run.shop.filter((o) => o.kind !== 'voucher') },
    });
    await render(<ConnectedShop />);
    expect(screen.queryByText(es.shop.voucher)).toBeNull();
  });
});
