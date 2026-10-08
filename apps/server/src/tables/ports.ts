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

export interface TableLogger {
  warn(message: string): void;
  error(message: string, trace?: string): void;
}
