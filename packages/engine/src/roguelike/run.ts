import { createStandardDeck, shuffleDeck, SUITS } from '../cards';
import { HAND_CATEGORIES, type HandCategory } from '../hands/hand-category';
import { evaluatePlayedHand } from '../hands/played-hand';
import { nextInt } from '../rng';
import { SeededRng, type SeededRngState } from '../seeded-rng';
import { DEFAULT_CONTENT } from './content';
import { handBase, scoreHand, type ScoreStep } from './scoring';
import type {
  BlindKind,
  BossDefinition,
  JokerDefinition,
  JokerEffect,
  JokerInstance,
  RunCard,
  RunContent,
} from './types';

/** Numbers only, so a config can be stored with the run and replayed. */
export interface RunConfig {
  readonly antes: number;
  /** Base target per ante (index 0 = ante 1). */
  readonly anteTargets: readonly number[];
  readonly blindTargetMultiplier: Readonly<Record<BlindKind, number>>;
  readonly blindReward: Readonly<Record<BlindKind, number>>;
  readonly moneyPerHandLeft: number;
  /** $1 for every `interestStep` held at the end of a round, up to `interestCap`. */
  readonly interestStep: number;
  readonly interestCap: number;
  readonly handSize: number;
  readonly hands: number;
  readonly discards: number;
  readonly maxCardsPerAction: number;
  readonly jokerSlots: number;
  readonly startingMoney: number;
  readonly shopJokerOffers: number;
  /** Hand level-up consumables offered per shop visit (distinct hand types). */
  readonly shopConsumableOffers: number;
  readonly consumablePrice: number;
  /** First reroll of a shop visit costs this much; each further reroll costs `rerollCostStep` more. */
  readonly rerollBaseCost: number;
  readonly rerollCostStep: number;
}

/** Bumped when the saved shape of `RunState` changes; older saves are discarded. */
export const RUN_STATE_VERSION = 1;

export const DEFAULT_RUN_CONFIG: RunConfig = {
  antes: 8,
  anteTargets: [250, 650, 1500, 3500, 7000, 12500, 20000, 32000],
  blindTargetMultiplier: { small: 1, big: 1.4, boss: 1.8 },
  blindReward: { small: 3, big: 4, boss: 5 },
  moneyPerHandLeft: 1,
  interestStep: 5,
  interestCap: 4,
  handSize: 8,
  hands: 4,
  discards: 3,
  maxCardsPerAction: 5,
  jokerSlots: 5,
  startingMoney: 4,
  shopJokerOffers: 2,
  shopConsumableOffers: 2,
  consumablePrice: 3,
  rerollBaseCost: 3,
  rerollCostStep: 1,
};

export type ShopOffer =
  | {
      readonly kind: 'joker';
      readonly jokerId: string;
      readonly price: number;
      readonly sold: boolean;
    }
  | {
      readonly kind: 'levelUp';
      readonly handType: HandCategory;
      readonly price: number;
      readonly sold: boolean;
    };

export type RunStatus = 'in_progress' | 'won' | 'lost' | 'abandoned';

export interface RunState {
  readonly version: number;
  readonly seed: string;
  readonly config: RunConfig;
  readonly status: RunStatus;
  readonly phase: 'blind' | 'shop' | 'ended';
  readonly ante: number;
  /** Current blind, or the next one while in the shop. */
  readonly blind: BlindKind;
  /** Boss of the current ante (known from its small blind). */
  readonly bossId: string;
  readonly target: number;
  readonly roundScore: number;
  /** Full deck composition. Each blind starts from a fresh shuffle of it. */
  readonly deck: readonly RunCard[];
  readonly drawPile: readonly RunCard[];
  readonly hand: readonly RunCard[];
  /** Cards in hand for the current blind (the boss can reduce it). */
  readonly handSize: number;
  readonly handsLeft: number;
  readonly discardsLeft: number;
  readonly money: number;
  readonly jokers: readonly JokerInstance[];
  readonly handLevels: Readonly<Record<HandCategory, number>>;
  readonly handsPlayed: number;
  readonly bestHandScore: number;
  readonly shop: readonly ShopOffer[];
  readonly rerollCost: number;
  /** Independent PRNG sub-streams, so buying in the shop never changes the cards dealt later. */
  readonly rng: {
    readonly deck: SeededRngState;
    readonly shop: SeededRngState;
    readonly boss: SeededRngState;
  };
  readonly nextJokerNumber: number;
}

export type RunAction =
  /** `cardIds` in play order (left to right). */
  | { readonly type: 'play'; readonly cardIds: readonly string[] }
  | { readonly type: 'discard'; readonly cardIds: readonly string[] }
  | { readonly type: 'buy'; readonly offerIndex: number }
  | { readonly type: 'sellJoker'; readonly instanceId: string }
  | { readonly type: 'moveJoker'; readonly from: number; readonly to: number }
  | { readonly type: 'reroll' }
  | { readonly type: 'leaveShop' }
  /** Reorders the hand (the order matters for held-card effects). */
  | { readonly type: 'sortHand'; readonly by: 'rank' | 'suit' }
  | { readonly type: 'abandon' };

export type RunErrorCode =
  | 'RUN_OVER'
  | 'INVALID_PHASE'
  | 'INVALID_CARDS'
  | 'NO_DISCARDS_LEFT'
  | 'INVALID_OFFER'
  | 'NOT_ENOUGH_MONEY'
  | 'NO_JOKER_SLOT'
  | 'INVALID_JOKER';

export type RunEvent =
  | {
      readonly type: 'blindStarted';
      readonly ante: number;
      readonly blind: BlindKind;
      readonly target: number;
      readonly bossId: string | null;
    }
  | { readonly type: 'cardsDrawn'; readonly cardIds: readonly string[] }
  | {
      readonly type: 'handScored';
      readonly handType: HandCategory;
      readonly playedIds: readonly string[];
      readonly scoringIds: readonly string[];
      readonly steps: readonly ScoreStep[];
      readonly chips: number;
      readonly mult: number;
      readonly score: number;
      readonly roundScore: number;
    }
  | { readonly type: 'discarded'; readonly cardIds: readonly string[] }
  | {
      readonly type: 'jokerTriggered';
      readonly instanceId: string;
      readonly hook: 'onDiscard' | 'onRoundEnd' | 'onShopEnter';
      readonly effect: JokerEffect;
    }
  | {
      readonly type: 'roundWon';
      readonly blindReward: number;
      readonly handsLeftBonus: number;
      readonly interest: number;
      readonly money: number;
    }
  | { readonly type: 'shopOpened'; readonly offers: readonly ShopOffer[] }
  | {
      readonly type: 'shopRerolled';
      readonly offers: readonly ShopOffer[];
      readonly money: number;
      readonly nextCost: number;
    }
  | { readonly type: 'bought'; readonly offerIndex: number; readonly money: number }
  | { readonly type: 'jokerSold'; readonly instanceId: string; readonly money: number }
  | { readonly type: 'runWon' }
  | { readonly type: 'runLost' }
  | { readonly type: 'runAbandoned' };

export type RunResult =
  | { readonly ok: true; readonly state: RunState; readonly events: readonly RunEvent[] }
  | {
      readonly ok: false;
      readonly error: { readonly code: RunErrorCode; readonly message: string };
    };

/** Seed + config + actions reproduce a run exactly. */
export interface RunLog {
  readonly seed: string;
  readonly config?: RunConfig;
  readonly actions: readonly RunAction[];
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
interface Draft extends Omit<
  Mutable<RunState>,
  'drawPile' | 'hand' | 'jokers' | 'handLevels' | 'shop' | 'rng'
> {
  drawPile: RunCard[];
  hand: RunCard[];
  jokers: JokerInstance[];
  handLevels: Record<HandCategory, number>;
  shop: ShopOffer[];
  rng: { deck: SeededRngState; shop: SeededRngState; boss: SeededRngState };
}

const BLIND_ORDER: readonly BlindKind[] = ['small', 'big', 'boss'];

export function createRun(
  seed: string,
  config: RunConfig = DEFAULT_RUN_CONFIG,
  content: RunContent = DEFAULT_CONTENT,
): { state: RunState; events: RunEvent[] } {
  if (config.anteTargets.length < config.antes)
    throw new RangeError('anteTargets must have one entry per ante');
  const events: RunEvent[] = [];
  const d: Draft = {
    version: RUN_STATE_VERSION,
    seed,
    config,
    status: 'in_progress',
    phase: 'blind',
    ante: 1,
    blind: 'small',
    bossId: '',
    target: 0,
    roundScore: 0,
    deck: createStandardDeck(),
    drawPile: [],
    hand: [],
    handSize: config.handSize,
    handsLeft: 0,
    discardsLeft: 0,
    money: config.startingMoney,
    jokers: [],
    handLevels: Object.fromEntries(HAND_CATEGORIES.map((h) => [h, 1])) as Record<
      HandCategory,
      number
    >,
    handsPlayed: 0,
    bestHandScore: 0,
    shop: [],
    rerollCost: config.rerollBaseCost,
    rng: {
      deck: SeededRng.fromSeed(seed, 'deck').getState(),
      shop: SeededRng.fromSeed(seed, 'shop').getState(),
      boss: SeededRng.fromSeed(seed, 'boss').getState(),
    },
    nextJokerNumber: 1,
  };
  pickBoss(d, content);
  startBlind(d, content, events);
  return { state: d, events };
}

/** Pure run reducer: never mutates `state`; invalid actions return an error and no state. */
export function runReducer(
  state: RunState,
  action: RunAction,
  content: RunContent = DEFAULT_CONTENT,
): RunResult {
  if (state.status !== 'in_progress') return fail('RUN_OVER', 'The run is over');
  const d = toDraft(state);
  const events: RunEvent[] = [];
  const error = apply(d, action, content, events);
  return error ? { ok: false, error } : { ok: true, state: d, events };
}

/** Replays a log from scratch. Throws if an action in the log is rejected. */
export function replayRun(
  log: RunLog,
  content: RunContent = DEFAULT_CONTENT,
): { state: RunState; events: RunEvent[] } {
  const created = createRun(log.seed, log.config, content);
  let state = created.state;
  const events = [...created.events];
  for (const [i, action] of log.actions.entries()) {
    const result = runReducer(state, action, content);
    if (!result.ok) throw new Error(`Action #${i} (${action.type}) rejected: ${result.error.code}`);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

type RunError = { code: RunErrorCode; message: string };

function apply(
  d: Draft,
  action: RunAction,
  content: RunContent,
  events: RunEvent[],
): RunError | null {
  switch (action.type) {
    case 'play':
      return play(d, action.cardIds, content, events);
    case 'discard':
      return discard(d, action.cardIds, content, events);
    case 'buy':
      return buy(d, action.offerIndex, content, events);
    case 'sellJoker':
      return sellJoker(d, action.instanceId, content, events);
    case 'moveJoker': {
      const { from, to } = action;
      const valid = (i: number) => Number.isInteger(i) && i >= 0 && i < d.jokers.length;
      if (!valid(from) || !valid(to)) return err('INVALID_JOKER', 'Joker position out of range');
      const [moved] = d.jokers.splice(from, 1);
      d.jokers.splice(to, 0, moved!);
      return null;
    }
    case 'reroll':
      return reroll(d, content, events);
    case 'sortHand':
      if (d.phase !== 'blind') return err('INVALID_PHASE', 'Not playing a blind');
      d.hand = sortCards(d.hand, action.by);
      return null;
    case 'leaveShop':
      if (d.phase !== 'shop') return err('INVALID_PHASE', 'Not in the shop');
      d.shop = [];
      startBlind(d, content, events);
      return null;
    case 'abandon':
      d.status = 'abandoned';
      d.phase = 'ended';
      events.push({ type: 'runAbandoned' });
      return null;
  }
}

// ---------------------------------------------------------------- blinds

function play(
  d: Draft,
  cardIds: readonly string[],
  content: RunContent,
  events: RunEvent[],
): RunError | null {
  if (d.phase !== 'blind') return err('INVALID_PHASE', 'Not playing a blind');
  const played = pickFromHand(d, cardIds);
  if (!played)
    return err(
      'INVALID_CARDS',
      `Select 1 to ${d.config.maxCardsPerAction} different cards from your hand`,
    );

  const held = d.hand.filter((c) => !played.includes(c));
  const boss = currentBoss(d, content);
  d.handsPlayed += 1;
  const result = scoreHand(
    {
      played,
      held,
      jokers: d.jokers,
      handLevels: d.handLevels,
      handsPlayed: d.handsPlayed,
      handsLeft: d.handsLeft - 1,
      discardsLeft: d.discardsLeft,
      money: d.money,
      ...(boss ? { isDebuffed: debuffRule(boss) } : {}),
    },
    content,
  );
  d.jokers = [...result.jokers];
  d.money += result.money;
  d.roundScore += result.score;
  d.bestHandScore = Math.max(d.bestHandScore, result.score);
  d.handsLeft -= 1;
  d.hand = held;
  events.push({
    type: 'handScored',
    handType: result.handType,
    playedIds: played.map((c) => c.id),
    scoringIds: result.scoringCards.map((c) => c.id),
    steps: result.steps,
    chips: result.chips,
    mult: result.mult,
    score: result.score,
    roundScore: d.roundScore,
  });

  if (d.roundScore >= d.target) {
    winRound(d, content, events);
  } else {
    draw(d, events);
    if (d.handsLeft === 0 || d.hand.length === 0) {
      d.status = 'lost';
      d.phase = 'ended';
      events.push({ type: 'runLost' });
    }
  }
  return null;
}

function discard(
  d: Draft,
  cardIds: readonly string[],
  content: RunContent,
  events: RunEvent[],
): RunError | null {
  if (d.phase !== 'blind') return err('INVALID_PHASE', 'Not playing a blind');
  if (d.discardsLeft <= 0) return err('NO_DISCARDS_LEFT', 'No discards left');
  const discarded = pickFromHand(d, cardIds);
  if (!discarded)
    return err(
      'INVALID_CARDS',
      `Select 1 to ${d.config.maxCardsPerAction} different cards from your hand`,
    );
  d.discardsLeft -= 1;
  d.hand = d.hand.filter((c) => !discarded.includes(c));
  events.push({ type: 'discarded', cardIds: discarded.map((c) => c.id) });
  runRunHook(d, content, events, 'onDiscard', (def, self) =>
    def.onDiscard?.(self, { discarded, money: d.money }),
  );
  draw(d, events);
  return null;
}

function winRound(d: Draft, content: RunContent, events: RunEvent[]): void {
  const { config } = d;
  runRunHook(d, content, events, 'onRoundEnd', (def, self) =>
    def.onRoundEnd?.(self, {
      blind: d.blind,
      handsLeft: d.handsLeft,
      discardsLeft: d.discardsLeft,
      money: d.money,
    }),
  );
  const blindReward = config.blindReward[d.blind];
  const handsLeftBonus = d.handsLeft * config.moneyPerHandLeft;
  const interest = Math.min(Math.floor(d.money / config.interestStep), config.interestCap);
  d.money += blindReward + handsLeftBonus + interest;
  events.push({ type: 'roundWon', blindReward, handsLeftBonus, interest, money: d.money });

  if (d.blind === 'boss' && d.ante === config.antes) {
    d.status = 'won';
    d.phase = 'ended';
    events.push({ type: 'runWon' });
    return;
  }
  if (d.blind === 'boss') {
    d.ante += 1;
    d.blind = 'small';
    pickBoss(d, content);
  } else {
    d.blind = BLIND_ORDER[BLIND_ORDER.indexOf(d.blind) + 1]!;
  }
  openShop(d, content, events);
}

function startBlind(d: Draft, content: RunContent, events: RunEvent[]): void {
  const { config } = d;
  d.phase = 'blind';
  const boss = currentBoss(d, content);
  d.target = roundTarget(config.anteTargets[d.ante - 1]! * config.blindTargetMultiplier[d.blind]);
  d.roundScore = 0;
  d.handsLeft = Math.max(1, config.hands + (boss?.handsDelta ?? 0));
  d.discardsLeft = Math.max(0, config.discards + (boss?.discardsDelta ?? 0));
  d.handSize = Math.max(1, config.handSize + (boss?.handSizeDelta ?? 0));
  const rng = new SeededRng(d.rng.deck);
  d.drawPile = shuffleDeck(rng, d.deck);
  d.rng.deck = rng.getState();
  d.hand = [];
  events.push({
    type: 'blindStarted',
    ante: d.ante,
    blind: d.blind,
    target: d.target,
    bossId: boss?.id ?? null,
  });
  draw(d, events);
}

function pickBoss(d: Draft, content: RunContent): void {
  const rng = new SeededRng(d.rng.boss);
  d.bossId = content.bosses[nextInt(rng, content.bosses.length)]!.id;
  d.rng.boss = rng.getState();
}

function draw(d: Draft, events: RunEvent[]): void {
  const drawn = d.drawPile.splice(0, Math.max(0, d.handSize - d.hand.length));
  d.hand.push(...drawn);
  if (drawn.length > 0) events.push({ type: 'cardsDrawn', cardIds: drawn.map((c) => c.id) });
}

/** The hand cards for `cardIds`, in that order, or null if the selection is invalid. */
function pickFromHand(d: Draft, cardIds: readonly string[]): RunCard[] | null {
  if (
    cardIds.length < 1 ||
    cardIds.length > d.config.maxCardsPerAction ||
    new Set(cardIds).size !== cardIds.length
  )
    return null;
  const cards = cardIds.map((id) => d.hand.find((c) => c.id === id));
  return cards.every((c) => c !== undefined) ? (cards as RunCard[]) : null;
}

// ---------------------------------------------------------------- shop

/** Random jokers (not owned, no repeats) and level-up consumables (distinct hand types). */
function rollOffers(d: Draft, content: RunContent): ShopOffer[] {
  const rng = new SeededRng(d.rng.shop);
  const owned = new Set(d.jokers.map((j) => j.jokerId));
  const pool = content.jokers.filter((j) => !owned.has(j.id));
  const offers: ShopOffer[] = [];
  for (let i = 0; i < d.config.shopJokerOffers && pool.length > 0; i++) {
    const [joker] = pool.splice(nextInt(rng, pool.length), 1);
    offers.push({ kind: 'joker', jokerId: joker!.id, price: joker!.cost, sold: false });
  }
  const handTypes = [...HAND_CATEGORIES];
  for (let i = 0; i < d.config.shopConsumableOffers && handTypes.length > 0; i++) {
    const [handType] = handTypes.splice(nextInt(rng, handTypes.length), 1);
    offers.push({
      kind: 'levelUp',
      handType: handType!,
      price: d.config.consumablePrice,
      sold: false,
    });
  }
  d.rng.shop = rng.getState();
  return offers;
}

function openShop(d: Draft, content: RunContent, events: RunEvent[]): void {
  const offers = rollOffers(d, content);
  d.shop = offers;
  d.rerollCost = d.config.rerollBaseCost;
  d.phase = 'shop';
  events.push({ type: 'shopOpened', offers });
  runRunHook(d, content, events, 'onShopEnter', (def, self) =>
    def.onShopEnter?.(self, { money: d.money }),
  );
}

function buy(
  d: Draft,
  offerIndex: number,
  content: RunContent,
  events: RunEvent[],
): RunError | null {
  if (d.phase !== 'shop') return err('INVALID_PHASE', 'Not in the shop');
  const offer = d.shop[offerIndex];
  if (!offer || offer.sold) return err('INVALID_OFFER', 'No such offer');
  if (d.money < offer.price) return err('NOT_ENOUGH_MONEY', 'Not enough money');
  if (offer.kind === 'joker') {
    if (d.jokers.length >= d.config.jokerSlots)
      return err('NO_JOKER_SLOT', 'All joker slots are full');
    const def = content.jokers.find((j) => j.id === offer.jokerId);
    d.jokers.push({
      instanceId: `j${d.nextJokerNumber++}`,
      jokerId: offer.jokerId,
      state: { ...def?.initialState },
    });
  } else {
    d.handLevels[offer.handType] += 1;
  }
  d.money -= offer.price;
  d.shop[offerIndex] = { ...offer, sold: true };
  events.push({ type: 'bought', offerIndex, money: d.money });
  return null;
}

function reroll(d: Draft, content: RunContent, events: RunEvent[]): RunError | null {
  if (d.phase !== 'shop') return err('INVALID_PHASE', 'Not in the shop');
  if (d.money < d.rerollCost) return err('NOT_ENOUGH_MONEY', 'Not enough money');
  d.money -= d.rerollCost;
  d.rerollCost += d.config.rerollCostStep;
  d.shop = rollOffers(d, content);
  events.push({ type: 'shopRerolled', offers: d.shop, money: d.money, nextCost: d.rerollCost });
  return null;
}

function sellJoker(
  d: Draft,
  instanceId: string,
  content: RunContent,
  events: RunEvent[],
): RunError | null {
  if (d.phase !== 'shop') return err('INVALID_PHASE', 'Jokers are sold in the shop');
  const index = d.jokers.findIndex((j) => j.instanceId === instanceId);
  if (index === -1) return err('INVALID_JOKER', 'No such joker');
  const value = jokerSellValue(d.jokers[index]!, content);
  d.jokers.splice(index, 1);
  d.money += value;
  events.push({ type: 'jokerSold', instanceId, money: d.money });
  return null;
}

// ---------------------------------------------------------------- helpers

/** Money you get for selling a joker: half its price, rounded down, at least $1. */
export function jokerSellValue(
  joker: JokerInstance,
  content: RunContent = DEFAULT_CONTENT,
): number {
  const cost = content.jokers.find((j) => j.id === joker.jokerId)?.cost ?? 2;
  return Math.max(1, Math.floor(cost / 2));
}

function currentBoss(d: Draft | RunState, content: RunContent): BossDefinition | undefined {
  return d.blind === 'boss' && d.phase !== 'shop'
    ? content.bosses.find((b) => b.id === d.bossId)
    : undefined;
}

function debuffRule(boss: BossDefinition): (card: RunCard) => boolean {
  return (card) =>
    card.suit === boss.debuffSuit || (boss.debuffRanks?.includes(card.rank) ?? false);
}

/** Is this card debuffed by the current boss? (For the UI: debuffed cards are marked.) */
export function isCardDebuffed(
  state: RunState,
  card: RunCard,
  content: RunContent = DEFAULT_CONTENT,
): boolean {
  const boss = currentBoss(state, content);
  return boss ? debuffRule(boss)(card) : false;
}

/** Rank: high to low, ties by suit. Suit: ♠ ♥ ♦ ♣, then high to low. */
function sortCards(cards: readonly RunCard[], by: 'rank' | 'suit'): RunCard[] {
  const suitIndex = (c: RunCard) => SUITS.indexOf(c.suit);
  return [...cards].sort((a, b) =>
    by === 'rank'
      ? b.rank - a.rank || suitIndex(a) - suitIndex(b)
      : suitIndex(a) - suitIndex(b) || b.rank - a.rank,
  );
}

export interface PlayPreview {
  readonly handType: HandCategory;
  readonly level: number;
  /** Base chips and mult of the hand type at its level (cards and jokers add more when played). */
  readonly chips: number;
  readonly mult: number;
  readonly scoringIds: readonly string[];
}

/** What playing `cardIds` would be, before jokers: for the selection preview. Null if not playable. */
export function previewPlay(
  state: RunState,
  cardIds: readonly string[],
  content: RunContent = DEFAULT_CONTENT,
): PlayPreview | null {
  if (
    state.phase !== 'blind' ||
    cardIds.length < 1 ||
    cardIds.length > state.config.maxCardsPerAction
  )
    return null;
  const cards = cardIds.map((id) => state.hand.find((c) => c.id === id));
  if (!cards.every((c) => c !== undefined) || new Set(cardIds).size !== cardIds.length) return null;
  const { type, scoringCards } = evaluatePlayedHand(cards as RunCard[]);
  const level = state.handLevels[type];
  return {
    handType: type,
    level,
    ...handBase(type, level, content),
    scoringIds: scoringCards.map((c) => c.id),
  };
}

/** Runs a run-level hook on every joker, left to right, applying money and state. */
function runRunHook(
  d: Draft,
  content: RunContent,
  events: RunEvent[],
  hook: 'onDiscard' | 'onRoundEnd' | 'onShopEnter',
  call: (def: JokerDefinition, self: JokerInstance) => JokerEffect | undefined,
): void {
  d.jokers.forEach((joker, i) => {
    const def = content.jokers.find((j) => j.id === joker.jokerId);
    const effect = def ? call(def, joker) : undefined;
    if (!effect) return;
    d.money += effect.money ?? 0;
    if (effect.state) d.jokers[i] = { ...joker, state: effect.state };
    events.push({ type: 'jokerTriggered', instanceId: joker.instanceId, hook, effect });
  });
}

function toDraft(state: RunState): Draft {
  return {
    ...state,
    drawPile: [...state.drawPile],
    hand: [...state.hand],
    jokers: [...state.jokers],
    handLevels: { ...state.handLevels },
    shop: [...state.shop],
    rng: { ...state.rng },
  };
}

function err(code: RunErrorCode, message: string): RunError {
  return { code, message };
}

function fail(code: RunErrorCode, message: string): RunResult {
  return { ok: false, error: { code, message } };
}

/** Readable targets: exact below 100, multiples of 10 below 1.000, of 50 below 10.000, of 100 above. */
function roundTarget(value: number): number {
  const step = value < 100 ? 1 : value < 1000 ? 10 : value < 10000 ? 50 : 100;
  return Math.max(step, Math.round(value / step) * step);
}
