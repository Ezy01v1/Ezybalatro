import { DEFAULT_RUN_CONFIG, type RunCard, type RunConfig, type RunState } from '@naipes/engine';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { DeckSheet } from '@/components/roguelike/DeckSheet';
import { GameScreen } from '@/components/roguelike/GameScreen';
import { ShopScreen } from '@/components/roguelike/ShopScreen';
import { PlayingCard } from '@/components/shared/PlayingCard';
import { useGame } from '@/game/store';
import { colors } from '@/theme/tokens';

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

/** `toHaveTextContent` with a string needs the whole text: this matches a part of it. */
const contains = (text: string) => new RegExp(text.replace(/[$^.*+?()[\]{}|\\]/g, '\\$&'));
const press = async (testID: string) => fireEvent.press(screen.getByTestId(testID));
const noop = () => {};

/** Starts a blind run holding the given consumables (instance ids c1, c2…). */
function startBlind(...consumableIds: string[]): RunState {
  useGame.getState().startRun('DECK-AND-BADGES');
  const run = useGame.getState().run!;
  const withItems: RunState = {
    ...run,
    consumables: consumableIds.map((consumableId, i) => ({
      instanceId: `c${i + 1}`,
      consumableId,
    })),
  };
  useGame.setState({ run: withItems });
  return withItems;
}

/** Uses consumable c1 on the given hand cards, through the store like the screen does. */
function useOn(...cardIds: string[]) {
  useGame.getState().beginTargeting('c1');
  for (const id of cardIds) useGame.getState().toggleCard(id);
  expect(useGame.getState().applyConsumable('c1')).toBeNull();
  return useGame.getState().run!;
}

function renderCard(card: RunCard, debuffed = false) {
  return render(<PlayingCard card={card} width={60} height={84} x={0} debuffed={debuffed} />);
}

const idOf = (tile: { props: { testID?: string } }) =>
  tile.props.testID!.slice('deck-card-'.length);

beforeEach(() => {
  jest.useFakeTimers();
  useGame.getState().exitRun();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('enhancement badge on a card', () => {
  it('a scoring enhancement is a filled tag with its short name', async () => {
    await renderCard({ id: 'k1', rank: 13, suit: 'h', enhancement: 'reinforced' });
    const badge = screen.getByTestId('card-badge-k1');
    expect(badge).toHaveTextContent('Ref');
    expect(badge).toHaveStyle({ backgroundColor: colors.primary });
    expect(screen.getByText('Ref')).toHaveStyle({ color: colors.primaryFg });
  });

  it('an in-hand enhancement is an outlined tag', async () => {
    await renderCard({ id: 'k1', rank: 13, suit: 'h', enhancement: 'anchor' });
    const badge = screen.getByTestId('card-badge-k1');
    expect(badge).toHaveTextContent('Anc');
    expect(badge).toHaveStyle({
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: colors.card.ink,
    });
    expect(screen.getByText('Anc')).toHaveStyle({ color: colors.card.ink });
  });

  it('the accessible label names the enhancement', async () => {
    await renderCard({ id: 'k1', rank: 13, suit: 'h', enhancement: 'reinforced' });
    expect(screen.getByTestId('card-k1').props.accessibilityLabel).toBe(
      'Rey de corazones, Reforzada',
    );
  });

  it('keeps the boss note after the enhancement in the label', async () => {
    await renderCard({ id: 'k1', rank: 13, suit: 'h', enhancement: 'heavy' }, true);
    expect(screen.getByTestId('card-k1').props.accessibilityLabel).toBe(
      'Rey de corazones, Pesada, No puntúa por el jefe',
    );
  });

  it('a card without enhancement has no badge and the plain label', async () => {
    await renderCard({ id: 'k1', rank: 13, suit: 'h' });
    expect(screen.queryByTestId('card-badge-k1')).toBeNull();
    expect(screen.getByTestId('card-k1').props.accessibilityLabel).toBe('Rey de corazones');
  });

  it('an unknown enhancement id paints nothing and does not throw', async () => {
    await renderCard({ id: 'k1', rank: 13, suit: 'h', enhancement: 'from_the_future' });
    expect(screen.queryByTestId('card-badge-k1')).toBeNull();
    expect(screen.getByTestId('card-k1').props.accessibilityLabel).toBe('Rey de corazones');
  });

  it('the face and the label come from rank and suit, never from the id', async () => {
    // The id of a king of spades that was painted hearts and raised to an ace.
    await renderCard({ id: 'Ks', rank: 14, suit: 'h' });
    expect(screen.getByTestId('card-Ks').props.accessibilityLabel).toBe('As de corazones');
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.queryByText('K')).toBeNull();
  });

  it('shows in the hand after using an enhancement consumable', async () => {
    startBlind('reinforce');
    const target = useGame.getState().run!.hand[0]!;
    useOn(target.id);
    await render(<ConnectedGame />);
    expect(screen.getByTestId(`card-badge-${target.id}`)).toHaveTextContent('Ref');
  });
});

describe('deck viewer', () => {
  it('in a blind, the counter opens the deck with 52 cards and what is left to draw', async () => {
    const run = startBlind();
    await render(<ConnectedGame />);
    expect(screen.queryByTestId('deck-sheet')).toBeNull();
    expect(screen.getByTestId('deck-open').props.accessibilityLabel).toBe('Ver mazo, 52 cartas');
    await press('deck-open');

    expect(screen.getByTestId('deck-sheet')).toBeTruthy();
    expect(screen.getByTestId('deck-total')).toHaveTextContent(
      `52 cartas · ${run.drawPile.length} por robar`,
    );
    expect(screen.getAllByTestId(/^deck-card-/)).toHaveLength(52);
  });

  it('the counter keeps showing the cards left to draw', async () => {
    const run = startBlind();
    await render(<ConnectedGame />);
    expect(screen.getByTestId('deck-open')).toHaveTextContent(`Mazo ${run.drawPile.length}`);
  });

  it('in the shop, "Ver mazo · 52" opens the deck without the draw pile', async () => {
    useGame.getState().startRun('DECK-SHOP', EASY);
    useGame.getState().toggleCard(useGame.getState().run!.hand[0]!.id);
    useGame.getState().play();
    useGame.getState().finishPlayback();
    useGame.getState().dismissRoundSummary();
    expect(useGame.getState().run!.phase).toBe('shop');
    await render(<ConnectedShop />);
    expect(screen.getByTestId('deck-open')).toHaveTextContent('Ver mazo · 52');
    expect(screen.getByTestId('deck-open').props.accessibilityLabel).toBe('Ver mazo, 52 cartas');
    await press('deck-open');

    expect(screen.getByTestId('deck-total')).toHaveTextContent('52 cartas');
    expect(screen.getByTestId('deck-total')).not.toHaveTextContent(contains('por robar'));
  });

  it('deck-close closes the sheet', async () => {
    startBlind();
    await render(<ConnectedGame />);
    await press('deck-open');
    expect(screen.getByTestId('deck-sheet')).toBeTruthy();
    await press('deck-close');
    expect(screen.queryByTestId('deck-sheet')).toBeNull();
  });

  it('groups the cards by suit with a count, highest rank first', async () => {
    const run = startBlind();
    await render(<DeckSheet visible run={run} onClose={noop} />);
    for (const suit of ['s', 'h', 'd', 'c'] as const) {
      const section = screen.getByTestId(`deck-suit-${suit}`);
      const ids = within(section)
        .getAllByTestId(/^deck-card-/)
        .map(idOf);
      expect(ids).toHaveLength(13);
      const cards = ids.map((id) => run.deck.find((c) => c.id === id)!);
      expect(cards.every((c) => c.suit === suit)).toBe(true);
      const ranks = cards.map((c) => c.rank);
      expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
      expect(within(section).getByText('13')).toBeTruthy();
    }
  });

  it('each suit is one accessible element whose label lists its cards; the tiles are not', async () => {
    const run = startBlind();
    await render(<DeckSheet visible run={run} onClose={noop} />);
    const hearts = screen.getByTestId('deck-suit-h');
    expect(hearts.props.accessible).toBe(true);
    expect(hearts.props.accessibilityLabel).toBe(
      'Corazones: 13 cartas. As, Rey, Reina, Jota, Diez, Nueve, Ocho, Siete, Seis, Cinco, Cuatro, Tres, Dos',
    );
    for (const tile of within(hearts).getAllByTestId(/^deck-card-/))
      expect(tile.props.accessible).toBe(false);
  });

  it('after a twin the deck has 53 cards and the copy is listed', async () => {
    startBlind('twin');
    const source = useGame.getState().run!.hand[0]!;
    const run = useOn(source.id);
    expect(run.deck).toHaveLength(53);
    await render(<DeckSheet visible run={run} onClose={noop} />);
    expect(screen.getByTestId('deck-total')).toHaveTextContent(contains('53 cartas'));
    expect(screen.getAllByTestId(/^deck-card-/)).toHaveLength(53);
    const section = screen.getByTestId(`deck-suit-${source.suit}`);
    expect(within(section).getAllByTestId(/^deck-card-/)).toHaveLength(14);
    expect(section.props.accessibilityLabel).toContain('14 cartas');
  });

  it('a card painted hearts is listed under hearts, not under the suit its id says', async () => {
    startBlind('paint_h');
    const target = useGame.getState().run!.hand.find((c) => c.suit !== 'h')!;
    const original = target.suit;
    const run = useOn(target.id);
    expect(run.deck.find((c) => c.id === target.id)).toMatchObject({ id: target.id, suit: 'h' });

    await render(<DeckSheet visible run={run} onClose={noop} />);
    const hearts = screen.getByTestId('deck-suit-h');
    const before = screen.getByTestId(`deck-suit-${original}`);
    expect(within(hearts).getByTestId(`deck-card-${target.id}`)).toBeTruthy();
    expect(within(before).queryByTestId(`deck-card-${target.id}`)).toBeNull();
    expect(hearts.props.accessibilityLabel).toContain('Corazones: 14 cartas');
    expect(before.props.accessibilityLabel).toContain('12 cartas');
  });

  it('enhanced cards show their badge and the suit label names the enhancement', async () => {
    startBlind('reinforce');
    const target = useGame.getState().run!.hand[0]!;
    const run = useOn(target.id);
    await render(<DeckSheet visible run={run} onClose={noop} />);
    expect(screen.getByTestId(`deck-badge-${target.id}`)).toHaveTextContent('Ref');
    expect(screen.getAllByTestId(/^deck-badge-/)).toHaveLength(1);
    const section = screen.getByTestId(`deck-suit-${target.suit}`);
    expect(section.props.accessibilityLabel).toContain(' Reforzada');
  });

  it('the legend explains the filled and outlined tags', async () => {
    const run = startBlind();
    await render(<DeckSheet visible run={run} onClose={noop} />);
    expect(screen.getByText(contains('Etiqueta rellena: actúa al puntuar'))).toBeTruthy();
  });

  it('a suit with no cards says so', async () => {
    const run = startBlind();
    // Every spade painted hearts (ids unchanged).
    const painted: RunState = {
      ...run,
      deck: run.deck.map((c) => (c.suit === 's' ? { ...c, suit: 'h' as const } : c)),
    };
    await render(<DeckSheet visible run={painted} onClose={noop} />);
    const spades = screen.getByTestId('deck-suit-s');
    expect(within(spades).queryAllByTestId(/^deck-card-/)).toHaveLength(0);
    expect(within(spades).getByText('Sin cartas')).toBeTruthy();
    expect(spades.props.accessibilityLabel).toBe('Picas: 0 cartas. Sin cartas');
    expect(screen.getByTestId('deck-suit-h').props.accessibilityLabel).toContain('26 cartas');
  });
});
