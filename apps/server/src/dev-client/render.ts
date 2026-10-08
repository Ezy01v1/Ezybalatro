import type { Card, HoldemEvent, TableView } from '@naipes/engine';
import type { TableUpdate } from '@naipes/shared';

const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const SUIT_SYMBOL = { s: '♠', h: '♥', d: '♦', c: '♣' } as const;
const RANK_LABEL: Record<number, string> = { 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

/** `A♠`; hearts and diamonds in red. */
export function formatCard(card: Card): string {
  const text = `${RANK_LABEL[card.rank] ?? String(card.rank)}${SUIT_SYMBOL[card.suit]}`;
  return card.suit === 'h' || card.suit === 'd' ? `${RED}${text}${RESET}` : text;
}

const formatCards = (cards: readonly Card[]): string => cards.map(formatCard).join(' ');

/** `dev:ana` → `ana`, `bot:rocio` → `rocio`. */
export function displayName(playerId: string): string {
  const colon = playerId.indexOf(':');
  return colon === -1 ? playerId : playerId.slice(colon + 1);
}

const STREET_LABEL: Record<string, string> = {
  preflop: 'preflop',
  flop: 'flop',
  turn: 'turn',
  river: 'river',
  settled: 'terminada',
  voided: 'anulada',
};

function nameOfSeat(view: TableView, seat: number): string {
  const playerId =
    view.seats[seat]?.playerId ?? view.hand?.players.find((p) => p.seat === seat)?.playerId;
  return playerId ? displayName(playerId) : `asiento ${seat}`;
}

/** One readable Spanish line per event, or null for events not worth showing. */
export function describeEvent(event: HoldemEvent, view: TableView): string | null {
  const who = (seat: number) => nameOfSeat(view, seat);
  switch (event.type) {
    case 'playerSat':
      return `${displayName(event.playerId)} se sienta con ${event.stack}`;
    case 'playerLeft':
      return `${displayName(event.playerId)} se va (${event.cashOut})`;
    case 'playerSatOut':
      return `${displayName(event.playerId)} queda fuera`;
    case 'playerSatIn':
      return `${displayName(event.playerId)} vuelve a la mesa`;
    case 'handStarted':
      return `Mano #${event.handNumber}`;
    case 'blindMissed':
      return `${who(event.seat)} pierde la ciega ${event.blind === 'small' ? 'chica' : 'grande'}`;
    case 'blindPosted': {
      const blind = { small: 'chica', big: 'grande', dead_small: 'chica muerta' }[event.blind];
      return `${who(event.seat)} pone la ciega ${blind} (${event.amount})`;
    }
    case 'playerActed': {
      const auto = event.auto ? ' (automático)' : '';
      const allIn = event.allIn ? ' y queda all-in' : '';
      switch (event.action) {
        case 'fold':
          return `${who(event.seat)} se retira${auto}`;
        case 'check':
          return `${who(event.seat)} pasa${auto}`;
        case 'call':
          return `${who(event.seat)} iguala ${event.amount}${allIn}${auto}`;
        case 'bet':
          return `${who(event.seat)} apuesta ${event.to}${allIn}${auto}`;
        case 'raise':
          return `${who(event.seat)} sube a ${event.to}${allIn}${auto}`;
      }
      return null;
    }
    case 'streetDealt':
      return `${STREET_LABEL[event.street] ?? event.street}: ${formatCards(event.cards)}`;
    case 'showdown':
      return event.hands
        .map((h) => `${who(h.seat)} muestra ${formatCards(h.holeCards)} (${h.category})`)
        .join(' · ');
    case 'potAwarded':
      return event.winners.map((w) => `Gana ${who(w.seat)}: ${w.amount}`).join(' · ');
    case 'handSettled':
      return null;
    case 'handVoided':
      return `Mano #${event.handNumber} anulada`;
  }
}

function seatLine(
  view: TableView,
  seat: number,
  me: string,
  turnSeat: number | null,
): string | null {
  const s = view.seats[seat];
  if (!s) return null;
  const hand = view.hand;
  const inHand = hand && hand.street !== 'settled' && hand.street !== 'voided';
  const player = hand?.players.find((p) => p.seat === seat);
  const marks: string[] = [];
  if (hand) {
    if (hand.buttonSeat === seat) marks.push('[B]');
    if (hand.smallBlindSeat === seat) marks.push('[SB]');
    if (hand.bigBlindSeat === seat) marks.push('[BB]');
  }
  if (s.status === 'sitting_out') marks.push('(fuera)');
  if (s.status === 'leaving') marks.push('(saliendo)');
  if (player?.folded) marks.push('(retirado)');
  if (player?.allIn && !player.folded) marks.push('(all-in)');
  if (turnSeat === seat) marks.push('← turno');

  const bet = player && player.streetBet > 0 ? `  apuesta ${player.streetBet}` : '';
  const youMark = s.playerId === me ? ' (tú)' : '';
  const name = `${displayName(s.playerId)}${youMark}`.padEnd(14);
  const line =
    `  ${seat}  ${name} ${String(s.stack).padStart(6)}${bet}  ${marks.join(' ')}`.trimEnd();
  return inHand && player?.folded ? `${DIM}${line}${RESET}` : line;
}

function describeLegal(view: TableView): string | null {
  const legal = view.legal;
  if (!legal) return null;
  const options = ['fold'];
  if (legal.canCheck) options.push('check');
  if (legal.callAmount > 0) options.push(`call ${legal.callAmount}`);
  if (legal.bet) options.push(`bet ${legal.bet.min}–${legal.bet.max}`);
  if (legal.raise) options.push(`raise ${legal.raise.min}–${legal.raise.max}`);
  if (legal.allIn !== null) options.push(`all-in ${legal.allIn}`);
  return options.join(' · ');
}

/**
 * Draws one table update for `me`. `elapsedMs` is how long ago the update arrived: the turn clock
 * (`turn.endsInMs`) is relative to its arrival.
 */
export function renderTable(update: TableUpdate, me: string, elapsedMs = 0): string {
  const { view, turn } = update;
  const hand = view.hand;
  const lines: string[] = [];
  const blinds = `${view.config.smallBlind}/${view.config.bigBlind}`;
  lines.push(
    `${BOLD}Mesa: ${update.tableId}${RESET}  ciegas ${blinds}  mano #${view.handNumber}` +
      (hand ? `  ${STREET_LABEL[hand.street] ?? hand.street}` : '  esperando jugadores'),
  );
  lines.push('');

  const turnSeat = turn?.seat ?? null;
  for (let seat = 0; seat < view.seats.length; seat++) {
    const line = seatLine(view, seat, me, turnSeat);
    if (line) lines.push(line);
  }
  lines.push('');

  if (hand) {
    lines.push(`Bote: ${hand.pot}`);
    lines.push(`Board: ${hand.board.length > 0 ? formatCards(hand.board) : '—'}`);
    const mine = hand.players.find((p) => p.playerId === me)?.holeCards;
    if (mine) lines.push(`Tus cartas: ${formatCards(mine)}`);
  }

  const legal = describeLegal(view);
  if (legal) {
    lines.push('');
    const seconds = turn ? Math.max(0, Math.ceil((turn.endsInMs - elapsedMs) / 1000)) : null;
    lines.push(`Tu turno${seconds !== null ? ` (${seconds} s)` : ''}: ${legal}`);
  } else if (turn) {
    const seconds = Math.max(0, Math.ceil((turn.endsInMs - elapsedMs) / 1000));
    lines.push('');
    lines.push(`Turno de ${nameOfSeat(view, turn.seat)} (${seconds} s)`);
  }

  const events = update.events.map((e) => describeEvent(e, view)).filter((l): l is string => !!l);
  if (events.length > 0) {
    lines.push('');
    for (const e of events) lines.push(`• ${e}`);
  }
  return lines.join('\n');
}
