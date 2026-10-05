const WORDS = [
  'LUNA',
  'SOL',
  'RIO',
  'MAR',
  'PUMA',
  'COLIBRI',
  'CEIBA',
  'ANDES',
  'CONDOR',
  'JAGUAR',
  'MANGO',
  'CACAO',
  'QUENA',
  'TANGO',
  'SALSA',
  'PAMPA',
  'SELVA',
  'LAGO',
  'VOLCAN',
  'BRISA',
];

/**
 * A short, readable random seed ("CONDOR-417"). Randomness here is fine: the seed is the input to
 * the deterministic engine, which never generates randomness itself.
 */
export function randomSeed(random: () => number = Math.random): string {
  const word = WORDS[Math.floor(random() * WORDS.length)]!;
  const number = 100 + Math.floor(random() * 900);
  return `${word}-${number}`;
}

/** Seeds are compared as typed, but surrounding spaces are ignored and letters are uppercased. */
export function normalizeSeed(text: string): string {
  return text.trim().toUpperCase();
}
