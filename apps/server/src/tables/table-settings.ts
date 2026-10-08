import type { TableConfig } from '@naipes/engine';
import type { Env } from '../config/env';

/** Injection token of the `TableSettings` (Nest). */
export const TABLE_SETTINGS = Symbol('TABLE_SETTINGS');

export interface TableTimings {
  turnTimeoutMs: number;
  disconnectGraceMs: number;
  sittingOutMaxMs: number;
  betweenHandsMs: number;
}

export interface TableSettings {
  config: TableConfig;
  timings: TableTimings;
  botFillTarget: number;
  emptyTableCloseMs: number;
  botDelayMs: { min: number; max: number };
  devWalletInitial: number;
  socketRateLimitPerSec: number;
}

export function tableSettingsFromEnv(env: Env): TableSettings {
  return {
    config: {
      maxSeats: env.TABLE_MAX_SEATS,
      smallBlind: env.TABLE_SMALL_BLIND,
      bigBlind: env.TABLE_BIG_BLIND,
      minBuyIn: env.TABLE_MIN_BUY_IN,
      maxBuyIn: env.TABLE_MAX_BUY_IN,
    },
    timings: {
      turnTimeoutMs: env.TURN_TIMEOUT_MS,
      disconnectGraceMs: env.DISCONNECT_GRACE_MS,
      sittingOutMaxMs: env.SITTING_OUT_MAX_MS,
      betweenHandsMs: env.BETWEEN_HANDS_MS,
    },
    botFillTarget: env.TABLE_BOT_FILL_TARGET,
    emptyTableCloseMs: env.EMPTY_TABLE_CLOSE_MS,
    botDelayMs: { min: env.BOT_DELAY_MIN_MS, max: env.BOT_DELAY_MAX_MS },
    devWalletInitial: env.CHIPS_INITIAL,
    socketRateLimitPerSec: env.SOCKET_RATE_LIMIT_PER_SEC,
  };
}
