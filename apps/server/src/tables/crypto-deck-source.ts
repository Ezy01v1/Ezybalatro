import { randomInt } from 'node:crypto';
import { createStandardDeck, shuffleDeck, type Card, type Rng } from '@naipes/engine';
import type { DeckSource } from './ports';

const cryptoRng: Rng = { nextUint32: () => randomInt(0, 2 ** 32) };

export class CryptoDeckSource implements DeckSource {
  nextDeck(): Card[] {
    return shuffleDeck(cryptoRng, createStandardDeck());
  }
}
