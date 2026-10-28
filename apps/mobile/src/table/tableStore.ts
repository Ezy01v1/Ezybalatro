import { create } from 'zustand';
import type { PlayerAction, SocketError, TableUpdate } from '@naipes/shared';
import { es } from '../i18n/es';
import type { ClientEvent, TableClient } from './tableClient';

export type TableStatus =
  | 'idle'
  | 'connecting'
  | 'waking'
  | 'seated'
  | 'reconnecting'
  | 'failed'
  | 'closed'
  | 'replaced';

export interface TableState {
  status: TableStatus;
  update: TableUpdate | null;
  prev: TableUpdate | null;
  /** `now()` at the moment the current update arrived (anchors the turn countdown). */
  turnReceivedAt: number;
  pendingAction: boolean;
  toast: string | null;
  leftWith: number | null;
  degraded: boolean;
  error: SocketError | null;
  start(buyIn?: number): void;
  act(action: PlayerAction): Promise<void>;
  sitOut(): Promise<void>;
  sitIn(): Promise<void>;
  leave(): Promise<void>;
  retry(): void;
  dismissToast(): void;
  reset(): void;
  /** Feed React Native's AppState: leaves the socket after a while in the background. */
  onAppState(state: string): void;
}

export const WAKING_AFTER_MS = 5000;
export const FAILED_AFTER_MS = 90000;
export const BACKGROUND_DISCONNECT_MS = 10000;

const RESYNC_CODES = new Set(['STALE_SEQ', 'NOT_YOUR_TURN', 'INVALID_AMOUNT']);

const initial = {
  status: 'idle' as TableStatus,
  update: null,
  prev: null,
  turnReceivedAt: 0,
  pendingAction: false,
  toast: null,
  leftWith: null,
  degraded: false,
  error: null,
};

export function createTableStore(client: TableClient, now: () => number = Date.now) {
  let wakingTimer: ReturnType<typeof setTimeout> | null = null;
  let failedTimer: ReturnType<typeof setTimeout> | null = null;
  let backgroundTimer: ReturnType<typeof setTimeout> | null = null;
  let lastBuyIn: number | undefined;
  let seating = false; // a quickSeat is in flight
  let wantSeat = false; // send quickSeat on the next 'connected'
  let droppedInBackground = false;

  const clearConnectTimers = (): void => {
    if (wakingTimer) clearTimeout(wakingTimer);
    if (failedTimer) clearTimeout(failedTimer);
    wakingTimer = null;
    failedTimer = null;
  };
  const clearBackgroundTimer = (): void => {
    if (backgroundTimer) clearTimeout(backgroundTimer);
    backgroundTimer = null;
  };

  const useStore = create<TableState>()((set, get) => {
    const trySeat = (): void => {
      if (!wantSeat || seating) return;
      wantSeat = false;
      seating = true;
      void client.quickSeat(lastBuyIn).then((ack) => {
        seating = false;
        if (ack.ok) return; // the table update arrives as an event
        clearConnectTimers();
        set({ status: 'failed', error: ack.error, pendingAction: false });
      });
    };

    const handleError = (error: SocketError): void => {
      if (RESYNC_CODES.has(error.code)) {
        set({ toast: es.table.resyncing, pendingAction: false });
        client.sync();
      } else {
        set({ toast: es.table.genericError, pendingAction: false });
      }
    };

    const onEvent = (event: ClientEvent): void => {
      const { status } = get();
      switch (event.type) {
        case 'status':
          if (event.status === 'connected') trySeat();
          else if (event.status === 'unauthorized') {
            clearConnectTimers();
            set({ status: 'failed' });
          } else if (status === 'seated') set({ status: 'reconnecting' });
          break;
        case 'update': {
          const current = get().update;
          const u = event.update;
          if (current && current.tableId === u.tableId && u.seq <= current.seq) break;
          clearConnectTimers();
          set({
            update: u,
            prev: current,
            turnReceivedAt: now(),
            pendingAction: false,
            status: 'seated',
          });
          break;
        }
        case 'closed':
          clearConnectTimers();
          set({ status: 'closed', pendingAction: false });
          break;
        case 'replaced':
          clearConnectTimers();
          set({ status: 'replaced', pendingAction: false });
          break;
        case 'degraded':
          set({ degraded: event.degraded.degraded });
          break;
        case 'error':
          handleError(event.error);
          break;
        case 'invalid':
          break;
      }
    };
    client.on(onEvent);

    const run = async (call: () => ReturnType<TableClient['sitOut']>): Promise<void> => {
      const ack = await call();
      if (!ack.ok) handleError(ack.error);
    };

    return {
      ...initial,

      start(buyIn) {
        if (get().status !== 'idle') return;
        lastBuyIn = buyIn;
        wantSeat = true;
        set({ ...initial, status: 'connecting' });
        wakingTimer = setTimeout(() => {
          if (get().status === 'connecting') set({ status: 'waking' });
        }, WAKING_AFTER_MS);
        failedTimer = setTimeout(() => {
          if (get().update === null && get().status !== 'failed') {
            client.disconnect();
            set({ status: 'failed' });
          }
        }, FAILED_AFTER_MS);
        client.connect();
      },

      async act(action) {
        const { update, pendingAction } = get();
        if (!update || pendingAction) return;
        set({ pendingAction: true });
        const ack = await client.act(update.seq, action);
        if (!ack.ok) handleError(ack.error);
      },

      sitOut: () => run(() => client.sitOut()),
      sitIn: () => run(() => client.sitIn()),

      async leave() {
        const ack = await client.leave();
        if (!ack.ok) {
          handleError(ack.error);
          return;
        }
        clearConnectTimers();
        clearBackgroundTimer();
        client.disconnect();
        set({ status: 'closed', leftWith: ack.cashOut, pendingAction: false });
      },

      retry() {
        if (get().status !== 'failed') return;
        client.disconnect();
        clearConnectTimers();
        seating = false;
        set({ ...initial });
        get().start(lastBuyIn);
      },

      dismissToast: () => set({ toast: null }),

      reset() {
        clearConnectTimers();
        clearBackgroundTimer();
        client.disconnect();
        seating = false;
        wantSeat = false;
        droppedInBackground = false;
        set({ ...initial });
      },

      onAppState(state) {
        if (state === 'active') {
          clearBackgroundTimer();
          if (droppedInBackground) {
            droppedInBackground = false;
            wantSeat = true;
            set({ status: 'reconnecting' });
            client.connect();
          }
          return;
        }
        const { status } = get();
        if (backgroundTimer || (status !== 'seated' && status !== 'reconnecting')) return;
        backgroundTimer = setTimeout(() => {
          backgroundTimer = null;
          droppedInBackground = true;
          client.disconnect();
        }, BACKGROUND_DISCONNECT_MS);
      },
    };
  });

  return useStore;
}
