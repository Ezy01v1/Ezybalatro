import type { Card } from '@naipes/engine';

export interface Timer {
  cancel(): void;
}

export interface Scheduler {
  now(): number;
  schedule(ms: number, fn: () => void): Timer;
}

export interface DeckSource {
  nextDeck(): Card[];
}

export interface WalletPort {
  balance(userId: string): Promise<number>;
  /** Returns false, touching nothing, when the balance is insufficient. */
  debit(userId: string, amount: number): Promise<boolean>;
  credit(userId: string, amount: number): Promise<void>;
}

export interface TableLogger {
  warn(message: string): void;
  error(message: string, trace?: string): void;
}
