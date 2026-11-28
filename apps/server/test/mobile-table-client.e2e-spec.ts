// Must be the first import: it sets the fast table timings before `AppModule` validates the env.
import './table-env';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TableUpdate } from '@naipes/shared';
// The mobile app's real client, driven against the real gateway (it only depends on
// socket.io-client and @naipes/shared, so it runs under Node as is).
import {
  createTableClient,
  type ClientEvent,
  type TableClient,
} from '../../mobile/src/table/tableClient';
import type { TestDatabase } from '../src/db/testing/test-database';
import { setupApp } from '../src/setup-app';
import { loadAppModule, startE2eDatabase } from './test-database-env';

function waitFor<T>(
  events: ClientEvent[],
  pick: (e: ClientEvent) => T | undefined,
  label: string,
  from = 0,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 15_000;
    const poll = (): void => {
      for (const e of events.slice(from)) {
        const hit = pick(e);
        if (hit !== undefined) return resolve(hit);
      }
      if (Date.now() > deadline) return reject(new Error(`Timed out waiting for ${label}`));
      setTimeout(poll, 20);
    };
    poll();
  });
}

const asUpdate = (e: ClientEvent): TableUpdate | undefined =>
  e.type === 'update' ? e.update : undefined;

describe('mobile tableClient against the real gateway', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let client: TableClient | null = null;

  beforeAll(async () => {
    db = await startE2eDatabase();
    const moduleRef = await Test.createTestingModule({ imports: [await loadAppModule()] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    client?.disconnect();
    await app?.close();
    await db?.stop();
  });

  it('connect → quickSeat → update → act → sync → leave', async () => {
    const url = await app.getUrl();
    client = createTableClient({ url, getToken: async () => 'dev:movil' });
    const events: ClientEvent[] = [];
    client.on((e) => events.push(e));

    client.connect();
    await waitFor(
      events,
      (e) => (e.type === 'status' && e.status === 'connected' ? true : undefined),
      'connected',
    );

    const seat = await client.quickSeat(1000);
    expect(seat.ok).toBe(true);

    // Wait until it is our turn, then act on what is legal.
    const myTurn = await waitFor(
      events,
      (e) => {
        const u = asUpdate(e);
        return u?.view.legal ? u : undefined;
      },
      'our turn',
    );
    const legal = myTurn.view.legal!;
    const acted = await client.act(myTurn.seq, legal.canCheck ? { type: 'check' } : { type: 'fold' });
    expect(acted).toMatchObject({ ok: true });

    // sync answers only through the ack: the client must surface it as an update.
    const before = events.length;
    client.sync();
    const synced = await waitFor(events, asUpdate, 'sync update', before);
    expect(synced.tableId).toBe(myTurn.tableId);

    const left = await client.leave();
    expect(left.ok).toBe(true);
    if (left.ok) expect(left.cashOut === null || typeof left.cashOut === 'number').toBe(true);
  });
});
