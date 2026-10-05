import {
  createRun,
  DEFAULT_RUN_CONFIG,
  runReducer,
  type RunAction,
  type RunConfig,
  type RunErrorCode,
  type RunEvent,
  type RunState,
} from '@naipes/engine';
import { create } from 'zustand';
import { clearRun, loadRun, saveRun } from './persistence';
import { buildPlayback, type Playback } from './playback';
import { randomSeed } from './seed';

export interface RoundSummary {
  readonly blindReward: number;
  readonly handsLeft: number;
  readonly handsLeftBonus: number;
  readonly interest: number;
  readonly jokerMoney: number;
  readonly total: number;
  /** The blind that was just beaten (the run already points at the next one). */
  readonly ante: number;
  readonly blind: RunState['blind'];
  readonly roundScore: number;
  readonly target: number;
}

export interface GameStore {
  run: RunState | null;
  selected: string[];
  /** Hand being scored. The engine already resolved it: `pendingRun` is applied when the playback ends. */
  playback: Playback | null;
  pendingRun: RunState | null;
  pendingEvents: readonly RunEvent[];
  roundSummary: RoundSummary | null;
  /** Result of reading the saved run at startup. */
  saveStatus: 'unknown' | 'none' | 'ok' | 'corrupt';
  /** Increments on every discard/deal so the hand can animate new cards. */
  dealCount: number;
  /** Sort chosen by the player; re-applied (through the engine) every time new cards are drawn. */
  sortMode: 'rank' | 'suit' | null;

  hydrate(): void;
  startRun(seed?: string, config?: RunConfig): void;
  /** 'limit' when 5 cards are already selected. */
  toggleCard(cardId: string): 'ok' | 'limit';
  play(): void;
  finishPlayback(): void;
  discard(): void;
  sortHand(by: 'rank' | 'suit'): void;
  buy(offerIndex: number): RunErrorCode | null;
  sellJoker(instanceId: string): void;
  reroll(): RunErrorCode | null;
  leaveShop(): void;
  moveJoker(from: number, to: number): void;
  abandon(): void;
  dismissRoundSummary(): void;
  exitRun(): void;
}

function summarize(
  events: readonly RunEvent[],
  handsLeft: number,
  beaten: Pick<RunState, 'ante' | 'blind' | 'target'>,
): RoundSummary | null {
  const won = events.find((e) => e.type === 'roundWon');
  if (!won || won.type !== 'roundWon') return null;
  const jokerMoney = events.reduce(
    (sum, e) =>
      sum + (e.type === 'jokerTriggered' && e.hook === 'onRoundEnd' ? (e.effect.money ?? 0) : 0),
    0,
  );
  return {
    blindReward: won.blindReward,
    handsLeft,
    handsLeftBonus: won.handsLeftBonus,
    interest: won.interest,
    jokerMoney,
    total: won.blindReward + won.handsLeftBonus + won.interest + jokerMoney,
    ante: beaten.ante,
    blind: beaten.blind,
    target: beaten.target,
    roundScore: events.reduce((score, e) => (e.type === 'handScored' ? e.roundScore : score), 0),
  };
}

/**
 * Zustand wraps the engine reducer (ADR 0002): components dispatch intents and render state.
 * No game rule lives here or in the UI; invalid intents are rejected by the engine.
 */
export const useGame = create<GameStore>((set, get) => {
  /** Applies an action; on success saves the run and returns the events. */
  const dispatch = (
    action: RunAction,
  ): { ok: true; events: readonly RunEvent[] } | { ok: false; code: RunErrorCode } => {
    const run = get().run;
    if (!run) return { ok: false, code: 'RUN_OVER' };
    const result = runReducer(run, action);
    if (!result.ok) return { ok: false, code: result.error.code };
    saveRun(result.state);
    set({ run: result.state });
    return { ok: true, events: result.events };
  };
  /** Keeps the player's chosen order after new cards arrive. */
  const resort = () => {
    const { sortMode, run } = get();
    if (sortMode && run?.phase === 'blind') dispatch({ type: 'sortHand', by: sortMode });
  };

  return {
    run: null,
    selected: [],
    playback: null,
    pendingRun: null,
    pendingEvents: [],
    roundSummary: null,
    saveStatus: 'unknown',
    dealCount: 0,
    sortMode: null,

    hydrate() {
      const loaded = loadRun();
      if (loaded.status === 'ok') set({ run: loaded.run, saveStatus: 'ok' });
      else set({ saveStatus: loaded.status });
    },

    startRun(seed = randomSeed(), config = DEFAULT_RUN_CONFIG) {
      const { state } = createRun(seed, config);
      saveRun(state);
      set({
        run: state,
        selected: [],
        playback: null,
        pendingRun: null,
        pendingEvents: [],
        roundSummary: null,
        saveStatus: 'ok',
        dealCount: get().dealCount + 1,
      });
    },

    toggleCard(cardId) {
      const { selected, run, playback } = get();
      if (!run || playback) return 'ok';
      if (selected.includes(cardId)) {
        set({ selected: selected.filter((id) => id !== cardId) });
        return 'ok';
      }
      if (selected.length >= run.config.maxCardsPerAction) return 'limit';
      set({ selected: [...selected, cardId] });
      return 'ok';
    },

    play() {
      const { run, selected, playback } = get();
      if (!run || playback || selected.length === 0) return;
      // Left-to-right play order follows the hand order, not the tapping order.
      const ordered = run.hand.filter((c) => selected.includes(c.id)).map((c) => c.id);
      const result = runReducer(run, { type: 'play', cardIds: ordered });
      if (!result.ok) return;
      const scored = result.events.find((e) => e.type === 'handScored');
      if (!scored || scored.type !== 'handScored') return;
      saveRun(result.state);
      set({
        playback: buildPlayback(scored),
        pendingRun: result.state,
        pendingEvents: result.events,
        selected: [],
      });
    },

    finishPlayback() {
      const { pendingRun, pendingEvents, run } = get();
      if (!pendingRun || !run) return;
      set({
        run: pendingRun,
        playback: null,
        pendingRun: null,
        pendingEvents: [],
        roundSummary: summarize(pendingEvents, pendingRun.handsLeft, run),
        dealCount: get().dealCount + 1,
      });
      resort();
    },

    discard() {
      const { run, selected, playback } = get();
      if (!run || playback || selected.length === 0) return;
      const result = dispatch({ type: 'discard', cardIds: selected });
      if (result.ok) set({ selected: [], dealCount: get().dealCount + 1 });
      resort();
    },

    sortHand(by) {
      set({ sortMode: by });
      dispatch({ type: 'sortHand', by });
    },

    buy(offerIndex) {
      const result = dispatch({ type: 'buy', offerIndex });
      return result.ok ? null : result.code;
    },

    sellJoker(instanceId) {
      dispatch({ type: 'sellJoker', instanceId });
    },

    reroll() {
      const result = dispatch({ type: 'reroll' });
      return result.ok ? null : result.code;
    },

    leaveShop() {
      if (dispatch({ type: 'leaveShop' }).ok) set({ dealCount: get().dealCount + 1 });
      resort();
    },

    moveJoker(from, to) {
      if (from !== to) dispatch({ type: 'moveJoker', from, to });
    },

    abandon() {
      dispatch({ type: 'abandon' });
      set({ selected: [] });
    },

    dismissRoundSummary() {
      set({ roundSummary: null });
    },

    exitRun() {
      clearRun();
      set({
        run: null,
        selected: [],
        playback: null,
        pendingRun: null,
        roundSummary: null,
        saveStatus: 'none',
      });
    },
  };
});
