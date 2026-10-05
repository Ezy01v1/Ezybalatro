import type { HandCategory, Rank, Suit } from '@naipes/engine';

// Suit characters inside text carry U+FE0E (text presentation): without it Android draws ♥ and ♦
// with the red color-emoji font. Cards use SVG suits (SuitIcon) instead of text.

/** All user-facing strings live here (es-419) so they can be translated later. */
export const es = {
  appName: 'Naipes',
  home: {
    subtitle: 'Elige cómo quieres jugar',
    roguelike: 'Roguelike',
    roguelikeHint: 'Un jugador, sin conexión',
    table: 'Mesa',
    tableHint: "Texas Hold'em en línea (próximamente)",
    continueRun: 'Continuar run',
    continueHint: (ante: number) => `Vas en el nivel ${ante}`,
    newRun: 'Nueva run',
    seededRun: 'Jugar con semilla',
    corruptSave: 'No pudimos recuperar tu run anterior. Puedes empezar una nueva.',
  },
  seed: {
    title: 'Jugar con semilla',
    label: 'Semilla',
    placeholder: 'LUNA-42',
    help: 'La misma semilla reparte siempre las mismas cartas.',
    start: 'Empezar',
    empty: 'Escribe una semilla para empezar.',
    back: 'Volver',
  },
  game: {
    level: (ante: number) => `Nivel ${ante}`,
    blind: { small: 'Ciega chica', big: 'Ciega grande', boss: 'Jefe' },
    of: (target: string) => `de ${target}`,
    scoreA11y: (score: string, target: string) => `Puntaje ${score} de ${target}`,
    pickCards: 'Elige hasta 5 cartas',
    handLabel: 'Tu mano',
    levelShort: (n: number) => `nv ${n}`,
    chips: 'fichas',
    mult: 'mult',
    times: '×',
    previewA11y: (hand: string, chips: string, mult: string) =>
      `${hand}, ${chips} fichas por ${mult} de multiplicador`,
    deck: (n: number) => `Mazo ${n}`,
    sortRank: 'Valor',
    sortSuit: 'Palo',
    sortLabel: 'Ordenar la mano',
    play: 'Jugar mano',
    discard: 'Descartar',
    noDiscards: 'Sin descartes',
    handsLeftA11y: (n: number) => `${n} manos restantes`,
    discardsLeftA11y: (n: number) => `${n} descartes restantes`,
    emptySlot: 'Espacio vacío',
    jokersLabel: 'Comodines',
    reorderHint: 'Mantén presionado y arrastra para cambiar el orden',
    skip: 'Toca para saltar',
    handLevels: 'Niveles de mano',
    close: 'Cerrar',
    abandon: 'Abandonar run',
    abandonConfirm: 'Toca otra vez para abandonar',
    debuffed: 'No puntúa por el jefe',
  },
  roundWon: {
    title: 'Ciega superada',
    reward: 'Recompensa de la ciega',
    handsLeft: (n: number) => `Manos sobrantes (${n})`,
    interest: 'Interés por ahorro',
    jokers: 'Comodines',
    total: 'Total',
    toShop: 'Ir a la tienda',
  },
  shop: {
    title: 'Tienda',
    jokers: 'Comodines',
    consumables: 'Estudios',
    buy: (price: number) => `Comprar $${price}`,
    bought: 'Comprado',
    missing: (n: number) => `Te faltan $${n}`,
    full: 'Comodines llenos',
    reroll: (price: number) => `Renovar $${price}`,
    sell: (price: number) => `Vender $${price}`,
    sellConfirm: (price: number) => `Confirmar venta $${price}`,
    next: 'Siguiente ciega',
    nextBoss: (boss: string) => `Siguiente: ${boss}`,
    yourJokers: 'Tus comodines',
    levelUp: (hand: string) => `Estudio: ${hand}`,
    levelUpDesc: 'Sube un nivel este tipo de mano (+fichas y +mult).',
  },
  runOver: {
    won: '¡Run ganada!',
    lost: 'Fin de la run',
    reached: (ante: number) => `Llegaste al nivel ${ante}`,
    bestHand: 'Mejor mano',
    seed: 'Semilla',
    copySeed: 'Copiar semilla',
    copied: 'Semilla copiada',
    newRun: 'Nueva run',
    replaySeed: 'Repetir semilla',
    home: 'Inicio',
  },
} as const;

export const HAND_NAMES: Record<HandCategory, string> = {
  high_card: 'Carta alta',
  pair: 'Par',
  two_pair: 'Doble par',
  three_of_a_kind: 'Trío',
  straight: 'Escalera',
  flush: 'Color',
  full_house: 'Full',
  four_of_a_kind: 'Póker',
  straight_flush: 'Escalera de color',
};

export const SUIT_NAMES: Record<Suit, string> = {
  s: 'picas',
  h: 'corazones',
  d: 'diamantes',
  c: 'tréboles',
};
export const SUIT_SYMBOLS: Record<Suit, string> = { s: '♠︎', h: '♥︎', d: '♦︎', c: '♣︎' };
export const RANK_LABELS: Record<Rank, string> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
};
export const RANK_NAMES: Record<Rank, string> = {
  2: 'Dos',
  3: 'Tres',
  4: 'Cuatro',
  5: 'Cinco',
  6: 'Seis',
  7: 'Siete',
  8: 'Ocho',
  9: 'Nueve',
  10: 'Diez',
  11: 'Jota',
  12: 'Reina',
  13: 'Rey',
  14: 'As',
};

/** Joker names and effects (ids come from the engine content). */
export const JOKER_TEXTS: Record<string, { name: string; short: string; description: string }> = {
  ember: { name: 'Brasa', short: '+4 mult', description: '+4 mult.' },
  prism: { name: 'Prisma', short: '×1,5', description: '×1,5 mult.' },
  stubborn_heart: {
    name: 'Corazón Terco',
    short: '♥︎ +3',
    description: '+3 mult por cada ♥︎ que puntúa.',
  },
  veteran: {
    name: 'Veterano',
    short: '+1/mano',
    description: '+1 mult por cada mano jugada desde que lo compraste.',
  },
  piggy_bank: { name: 'Alcancía', short: '+$3', description: '+$3 al superar cada ciega.' },
  spade_leaf: {
    name: 'Hoja de Pica',
    short: '♠︎ +25',
    description: '+25 fichas por cada ♠︎ que puntúa.',
  },
  rough_diamond: {
    name: 'Diamante en Bruto',
    short: '♦︎ +$1',
    description: '+$1 por cada ♦︎ que puntúa.',
  },
  old_clover: {
    name: 'Trébol Viejo',
    short: '♣︎ +3',
    description: '+3 mult por cada ♣︎ que puntúa.',
  },
  happy_couple: {
    name: 'Pareja Feliz',
    short: 'Par +8',
    description: '+8 mult si la mano tiene un par.',
  },
  spiral_stair: {
    name: 'Escalera de Caracol',
    short: 'Esc +80',
    description: '+80 fichas si juegas una escalera.',
  },
  fan: { name: 'Abanico', short: 'Color +60', description: '+60 fichas si juegas un color.' },
  dynamic_trio: {
    name: 'Trío Dinámico',
    short: 'Trío ×2',
    description: '×2 mult con trío, full o póker.',
  },
  minimalist: {
    name: 'Minimalista',
    short: '≤3 +12',
    description: '+12 mult si juegas 3 cartas o menos.',
  },
  steady_hand: {
    name: 'Mano Firme',
    short: 'Mano +2',
    description: '+2 mult por cada carta que queda en tu mano.',
  },
  wise_discard: {
    name: 'Descarte Sabio',
    short: '+4/desc.',
    description: 'Gana +4 fichas por cada carta descartada y las suma a cada mano.',
  },
  saver: { name: 'Ahorrista', short: '$5 → +1', description: '+1 mult por cada $5 que tengas.' },
  last_breath: {
    name: 'Último Aliento',
    short: 'Última ×3',
    description: '×3 mult en la última mano de la ronda.',
  },
  ace_sleeve: {
    name: 'As Bajo la Manga',
    short: 'A +20 +4',
    description: 'Cada As que puntúa da +20 fichas y +4 mult.',
  },
  figurine: {
    name: 'Figurín',
    short: 'J Q K +3',
    description: 'Cada figura (J, Q, K) que puntúa da +3 mult.',
  },
  tip_jar: {
    name: 'Propina',
    short: '+$1/mano',
    description: '+$1 por cada mano sobrante al superar una ciega.',
  },
};

export const BOSS_TEXTS: Record<string, { name: string; rule: string }> = {
  fog: { name: 'La Niebla', rule: 'Las ♠︎ no puntúan' },
  drought: { name: 'La Sequía', rule: 'Sin descartes' },
  clock: { name: 'El Reloj', rule: 'Una mano menos, un descarte más' },
  press: { name: 'La Prensa', rule: 'Una carta menos en la mano' },
  mask: { name: 'La Máscara', rule: 'Las figuras (J, Q, K) no puntúan' },
};
