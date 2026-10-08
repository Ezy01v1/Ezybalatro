import type { HoldemEvent, ShowdownHand, TableState } from '@naipes/engine';
import type { HandActionRecord, HandRecord } from './table-store';

type Street = HandActionRecord['street'];

/**
 * Follows the events of the hand in progress and builds its `HandRecord` when it ends. Only what
 * the events show goes in: blinds and actions in order, and the hands shown at showdown (never the
 * mucked ones).
 */
export class HandRecorder {
  private street: Street = 'preflop';
  private actions: HandActionRecord[] = [];
  private shown: ShowdownHand[] = [];

  /** Feed every committed batch of events, in order. */
  observe(events: readonly HoldemEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'handStarted':
          this.street = 'preflop';
          this.actions = [];
          this.shown = [];
          break;
        case 'streetDealt':
          this.street = e.street;
          break;
        case 'blindPosted':
          this.push(e.seat, 'post_blind', e.amount);
          break;
        case 'playerActed':
          this.push(
            e.seat,
            e.auto === 'timeout' ? 'timeout' : e.allIn ? 'all_in' : e.action,
            e.amount,
          );
          break;
        case 'showdown':
          this.shown = e.hands.map((h) => structuredClone(h) as ShowdownHand);
          break;
        default:
          break;
      }
    }
  }

  /**
   * The record of the hand that `events` ended (a `handSettled` or `handVoided` among them), built
   * from the state right after; null if they ended no hand. A voided hand keeps no actions, awards
   * nor cards: its stacks are back to the start of the hand.
   */
  build(tableId: string, state: TableState, events: readonly HoldemEvent[]): HandRecord | null {
    const end = events.find((e) => e.type === 'handSettled' || e.type === 'handVoided');
    const hand = state.hand;
    if (!end || !hand) return null;
    const voided = end.type === 'handVoided';
    const leavers = events.flatMap((e) =>
      e.type === 'playerLeft' ? [{ playerId: e.playerId, seat: e.seat, cashOut: e.cashOut }] : [],
    );
    const stacks = state.seats.flatMap((s, seat) => (s ? [{ seat, stack: s.stack }] : []));
    return {
      tableId,
      handNumber: hand.handNumber,
      status: voided ? 'voided' : 'settled',
      buttonSeat: hand.buttonSeat,
      board: voided ? [] : [...hand.board],
      awards: voided ? [] : structuredClone(hand.awards as HandRecord['awards']),
      shownHands: voided ? [] : this.shown,
      actions: voided ? [] : this.actions,
      stacks,
      leavers,
    };
  }

  private push(seat: number, type: HandActionRecord['type'], amount: number): void {
    this.actions.push({ seq: this.actions.length + 1, seat, street: this.street, type, amount });
  }
}
