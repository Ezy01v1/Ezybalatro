/**
 * Developer console client of the Hold'em table (`pnpm play -- --name ana`). Not part of the app:
 * `main.ts` never imports it. User-facing text is Spanish (es-419).
 */
import { createInterface } from 'node:readline';
import { io } from 'socket.io-client';
import {
  SOCKET_EVENTS,
  type Ack,
  type SocketError,
  type TableClosed,
  type TableUpdate,
} from '@naipes/shared';
import { connectErrorAction, disconnectAction } from './connection-policy';
import { HELP_TEXT, parseCommand } from './parse-command';
import { renderTable } from './render';

interface Options {
  name: string;
  url: string;
  buyIn: number | undefined;
}

function parseArgs(argv: string[]): Options | { error: string } {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) continue;
    const [key, inline] = arg.slice(2).split('=', 2) as [string, string | undefined];
    const value = inline ?? argv[++i];
    if (value === undefined) return { error: `Falta el valor de --${key}` };
    values.set(key, value);
  }
  const name = values.get('name');
  if (!name || !/^[A-Za-z0-9_]{3,20}$/.test(name)) {
    return {
      error:
        'Uso: pnpm play -- --name <nombre> [--url http://localhost:3000] [--buy-in 1000]\n--name: 3 a 20 caracteres (letras, números o _)',
    };
  }
  const buyInText = values.get('buy-in');
  const buyIn = buyInText === undefined ? undefined : Number(buyInText);
  if (buyIn !== undefined && !(Number.isSafeInteger(buyIn) && buyIn > 0)) {
    return { error: '--buy-in debe ser un entero positivo' };
  }
  return { name, url: values.get('url') ?? 'http://localhost:3000', buyIn };
}

const parsed = parseArgs(process.argv.slice(2));
if ('error' in parsed) {
  console.error(parsed.error);
  process.exit(2);
}
const { name, url, buyIn } = parsed;
const me = `dev:${name}`;

const CLEAR = '\x1b[2J\x1b[H';

/** Latest update per table, with its arrival time (a user can briefly get updates for two tables). */
const latest = new Map<string, { update: TableUpdate; at: number }>();
let currentTableId: string | null = null;
let notice: string | null = null;
let seating = false;
let leaving = false;
let done = false;
let everConnected = false;

const socket = io(url, {
  transports: ['websocket'],
  auth: { token: me },
});

const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });

function draw(): void {
  const entry = currentTableId ? latest.get(currentTableId) : undefined;
  let screen = CLEAR;
  if (entry) {
    screen += renderTable(entry.update, me, Date.now() - entry.at) + '\n';
  } else {
    screen += `Conectado como ${name}. Buscando mesa...\n`;
  }
  if (notice) screen += `\n${notice}\n`;
  screen += `\n${HELP_TEXT}\n`;
  process.stdout.write(screen);
  rl.prompt(true);
}

function showError(error: SocketError): void {
  notice = `⚠ ${error.code}: ${error.message}`;
  draw();
}

function shutdown(code = 0): void {
  if (done) return;
  done = true;
  clearInterval(clock);
  socket.close();
  rl.close();
  process.exitCode = code;
}

function quickSeat(): void {
  if (seating) return;
  seating = true;
  const payload = buyIn === undefined ? {} : { buyIn };
  socket.emit(SOCKET_EVENTS.quickSeat, payload, (ack: Ack<{ tableId: string; seat: number }>) => {
    seating = false;
    if (!ack.ok) {
      currentTableId = null;
      showError(ack.error);
      return;
    }
    currentTableId = ack.tableId;
    notice = null;
    draw();
  });
}

// Every (re)connection asks for a seat: quickSeat is idempotent, and after a server restart the old
// table is gone, so a remembered tableId would be stale.
socket.on('connect', () => {
  everConnected = true;
  quickSeat();
});

socket.on('connect_error', (error) => {
  if (connectErrorAction({ everConnected, message: error.message }) === 'exit') {
    console.error(`No se pudo conectar a ${url}: ${error.message}`);
    shutdown(1);
    return;
  }
  notice = 'Servidor no disponible. Reconectando...';
  draw();
});

socket.on('disconnect', (reason) => {
  const action = disconnectAction({ reason, leaving, done });
  if (action === 'none') return;
  seating = false;
  notice = `Desconectado (${reason}). Reconectando...`;
  draw();
  // socket.io does not retry after a server-initiated disconnect on its own.
  if (action === 'manual') socket.connect();
});

socket.on(SOCKET_EVENTS.tableUpdate, (update: TableUpdate) => {
  latest.set(update.tableId, { update, at: Date.now() });
  if (currentTableId !== null && update.tableId !== currentTableId) {
    // The seat at the previous table can still report its last hand: only note it.
    notice = `(actualización de otra mesa ignorada: ${update.tableId})`;
  }
  draw();
});

socket.on(SOCKET_EVENTS.tableClosed, (closed: TableClosed) => {
  latest.delete(closed.tableId);
  if (closed.tableId !== currentTableId) return;
  currentTableId = null;
  notice = `La mesa se cerró (${closed.reason}).`;
  draw();
  if (closed.reason !== 'shutdown') {
    // Sit at a fresh table; after a shutdown the reconnect does it once the server is back.
    if (socket.connected) quickSeat();
  }
});

socket.on(SOCKET_EVENTS.sessionReplaced, (error: SocketError) => {
  console.error(`\n⚠ ${error.code}: ${error.message}`);
  shutdown(1);
});

function send<T extends object>(
  event: string,
  payload: object,
  then?: (ack: { ok: true } & T) => void,
): void {
  socket.timeout(5000).emit(event, payload, (timedOut: Error | null, ack: Ack<T>) => {
    if (timedOut) {
      notice = '⚠ El servidor no respondió a tiempo';
      draw();
      return;
    }
    if (!ack.ok) {
      showError(ack.error);
      return;
    }
    notice = null;
    then?.(ack);
  });
}

rl.on('line', (line) => {
  const command = parseCommand(line);
  if ('error' in command) {
    notice = `⚠ ${command.error}`;
    draw();
    return;
  }
  if (command.kind === 'quit') {
    shutdown();
    return;
  }
  const entry = currentTableId ? latest.get(currentTableId) : undefined;
  if (!currentTableId || !entry) {
    notice = '⚠ Todavía no estás sentado en una mesa';
    draw();
    return;
  }
  const tableId = currentTableId;
  switch (command.kind) {
    case 'act':
      send(SOCKET_EVENTS.act, { tableId, seq: entry.update.seq, action: command.action });
      break;
    case 'sitOut':
      send(SOCKET_EVENTS.sitOut, { tableId });
      break;
    case 'sitIn':
      send(SOCKET_EVENTS.sitIn, { tableId });
      break;
    case 'leave':
      send<{ cashOut: number | null }>(SOCKET_EVENTS.leave, { tableId }, (ack) => {
        leaving = true;
        console.log(
          ack.cashOut === null
            ? 'Saldrás al terminar la mano.'
            : `Te fuiste con ${ack.cashOut} fichas.`,
        );
        shutdown();
      });
      break;
  }
});

// Stdin closed (Ctrl+D or a script): same as `q`.
rl.on('close', () => {
  shutdown();
});

// Keeps the turn countdown moving between updates.
const clock = setInterval(() => {
  const entry = currentTableId ? latest.get(currentTableId) : undefined;
  if (entry?.update.turn) draw();
}, 1000);
