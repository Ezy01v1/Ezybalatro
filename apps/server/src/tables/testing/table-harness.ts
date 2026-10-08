import { createStandardDeck, type Card, type LegalActions, type TableConfig } from '@naipes/engine';
import type { PlayerAction } from '@naipes/shared';
import { HouseBankroll, InMemoryWallet } from '../in-memory-wallet';
import type { DeckSource, TableLogger } from '../ports';
import type { TableTimings } from '../table-settings';
import { TableRuntime, type TableMessage, type TableRuntimeDeps } from '../table-runtime';
import { FakeScheduler } from './fake-scheduler';

export const TEST_CONFIG: TableConfig = {
  maxSeats: 6,
  smallBlind: 10,
  bigBlind: 20,
  minBuyIn: 400,
  maxBuyIn: 2000,
};

export const TEST_TIMINGS: TableTimings = {
  turnTimeoutMs: 20_000,
  disconnectGraceMs: 45_000,
  sittingOutMaxMs: 300_000,
  betweenHandsMs: 3_000,
};

export const TEST_WALLET_INITIAL = 10_000;

/** Deals the unshuffled standard deck, or the decks returned by `next` when given. */
export function fixedDeckSource(next: () => Card[] = createStandardDeck): DeckSource {
  return { nextDeck: next };
}

export interface TestLogger extends TableLogger {
  warn: jest.Mock<void, [string]>;
  error: jest.Mock<void, [string, string?]>;
}

export interface Harness<R extends TableRuntime = TableRuntime> {
  runtime: R;
  scheduler: FakeScheduler;
  wallet: InMemoryWallet;
  house: HouseBankroll;
  logger: TestLogger;
  /** Messages received by each player subscribed through `join` or `listen`. */
  messages: Map<string, TableMessage[]>;
}

export function makeRuntime<R extends TableRuntime = TableRuntime>(
  overrides: Partial<TableRuntimeDeps> = {},
  Ctor?: new (deps: TableRuntimeDeps) => R,
): Harness<R> {
  const scheduler = (overrides.scheduler as FakeScheduler | undefined) ?? new FakeScheduler();
  const wallet =
    (overrides.wallet as InMemoryWallet | undefined) ?? new InMemoryWallet(TEST_WALLET_INITIAL);
  const house = (overrides.house as HouseBankroll | undefined) ?? new HouseBankroll();
  const logger: TestLogger = { warn: jest.fn(), error: jest.fn() };
  const deps: TableRuntimeDeps = {
    id: 't1',
    config: TEST_CONFIG,
    timings: TEST_TIMINGS,
    deckSource: fixedDeckSource(),
    logger,
    ...overrides,
    scheduler,
    wallet,
    house,
  };
  const runtime = Ctor ? new Ctor(deps) : (new TableRuntime(deps) as R);
  return {
    runtime,
    scheduler,
    wallet,
    house,
    logger: deps.logger as TestLogger,
    messages: new Map(),
  };
}

/** Subscribes `playerId`, recording every message in `harness.messages`. */
export function listen(harness: Harness, playerId: string): () => void {
  const log: TableMessage[] = [];
  harness.messages.set(playerId, log);
  return harness.runtime.subscribe(playerId, (m) => log.push(m));
}

/** Subscribes and sits `playerId`; throws if the sit is rejected. */
export async function join(
  harness: Harness,
  playerId: string,
  buyIn = 1000,
  postBlindsToEnter?: boolean,
): Promise<number> {
  listen(harness, playerId);
  const result = await harness.runtime.sit(playerId, buyIn, postBlindsToEnter);
  if (!result.ok) throw new Error(`sit ${playerId} failed: ${result.error.code}`);
  return result.seat;
}

/** Every event received by `playerId`, flattened. */
export function eventsOf(harness: Harness, playerId: string) {
  return (harness.messages.get(playerId) ?? []).flatMap((m) =>
    m.type === 'update' ? [...m.update.events] : [],
  );
}

export type ChooseAction = (legal: LegalActions, playerId: string) => PlayerAction;

export const checkOrCall: ChooseAction = (legal) =>
  legal.canCheck ? { type: 'check' } : legal.callAmount > 0 ? { type: 'call' } : { type: 'fold' };

export interface AutoPlayOptions {
  /** Default: check if free, otherwise call. */
  choose?: ChooseAction;
  /** Runs after every action and every clock step (e.g. to check invariants). */
  afterStep?: () => void | Promise<void>;
  /** Clock step used to wait for the next hand. Default 1000 ms. */
  stepMs?: number;
}

/**
 * Plays until `hands` more hands have ended (settled or voided), acting for whoever is to act.
 * Throws if the table stops making progress.
 */
export async function autoPlay(
  runtime: TableRuntime,
  scheduler: FakeScheduler,
  hands: number,
  options: AutoPlayOptions = {},
): Promise<void> {
  const choose = options.choose ?? checkOrCall;
  const stepMs = options.stepMs ?? 1000;
  const lastHand = () => runtime.snapshot('').view.handNumber;
  const target = lastHand() + hands - (runtime.isHandInProgress() ? 1 : 0);
  let idleSteps = 0;
  while (lastHand() < target || runtime.isHandInProgress()) {
    if (runtime.status === 'closed') throw new Error('Table closed during autoPlay');
    const hand = runtime.snapshot('').view.hand;
    const seat = hand && runtime.isHandInProgress() ? hand.toAct : null;
    const playerId = seat === null ? null : runtime.snapshot('').view.seats[seat]?.playerId;
    if (playerId) {
      idleSteps = 0;
      const update = runtime.snapshot(playerId);
      const legal = update.view.legal;
      if (!legal) throw new Error('Player to act has no legal actions');
      const result = await runtime.act(playerId, update.seq, choose(legal, playerId));
      if (!result.ok) throw new Error(`autoPlay act failed: ${result.error.code}`);
    } else {
      if (++idleSteps > 100) throw new Error('autoPlay: no hand is starting');
      await scheduler.advance(stepMs);
    }
    await options.afterStep?.();
  }
}
