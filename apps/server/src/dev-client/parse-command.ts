import type { PlayerAction } from '@naipes/shared';

export type Command =
  | { kind: 'act'; action: PlayerAction }
  | { kind: 'sitOut' }
  | { kind: 'sitIn' }
  | { kind: 'leave' }
  | { kind: 'quit' };

export const HELP_TEXT =
  'Comandos: f (retirarse) · k (pasar) · c (igualar) · b <n> (apostar) · r <n> (subir a) · a (all-in) · sitout · sitin · leave · q (salir)';

const SIMPLE_ACTIONS: Record<string, PlayerAction> = {
  f: { type: 'fold' },
  k: { type: 'check' },
  c: { type: 'call' },
  a: { type: 'allIn' },
};

const SIMPLE_COMMANDS: Record<string, Command> = {
  sitout: { kind: 'sitOut' },
  sitin: { kind: 'sitIn' },
  leave: { kind: 'leave' },
  q: { kind: 'quit' },
};

function parseAmount(word: string | undefined): number | null {
  if (word === undefined || !/^\d+$/.test(word)) return null;
  const amount = Number(word);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function parseCommand(line: string): Command | { error: string } {
  const words = line.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const [name, ...args] = words;
  if (!name) return { error: 'Escribe un comando. ' + HELP_TEXT };

  if (name === 'b' || name === 'r') {
    const amount = args.length === 1 ? parseAmount(args[0]) : null;
    if (amount === null) {
      return { error: `Uso: ${name} <monto> (entero positivo)` };
    }
    return {
      kind: 'act',
      action: name === 'b' ? { type: 'bet', amount } : { type: 'raise', to: amount },
    };
  }

  const action = SIMPLE_ACTIONS[name];
  const command = action ? ({ kind: 'act', action } as const) : SIMPLE_COMMANDS[name];
  if (command) {
    if (args.length > 0) return { error: `El comando ${name} no lleva argumentos` };
    return command;
  }
  return { error: `Comando desconocido: ${name}. ${HELP_TEXT}` };
}
