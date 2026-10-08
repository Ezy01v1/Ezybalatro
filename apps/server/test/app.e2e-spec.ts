import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';

describe('App (e2e)', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health -> 200 { status: ok }', async () => {
    await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' });
  });

  it('unknown route -> error envelope', async () => {
    const res = await request(app.getHttpServer()).get('/nope').expect(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: expect.any(String), requestId: expect.any(String) },
    });
  });

  it('socket "ping" -> pong ack', async () => {
    // Every connection is authenticated (TableGateway middleware on the shared server).
    const socket: Socket = io(url, { transports: ['websocket'], auth: { token: 'dev:pinger' } });
    try {
      const reply: unknown = await socket.timeout(5000).emitWithAck('ping');
      expect(reply).toMatchObject({ type: 'pong', serverTime: expect.any(Number) });
    } finally {
      socket.disconnect();
    }
  });
});
