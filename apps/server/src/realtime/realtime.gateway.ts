import { SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { SOCKET_EVENTS, type Pong } from '@naipes/shared';

/** Empty Socket.IO gateway (ADR 0004). Table logic arrives in Phase 3. */
@WebSocketGateway()
export class RealtimeGateway {
  @SubscribeMessage(SOCKET_EVENTS.ping)
  handlePing(): Pong {
    return { type: 'pong', serverTime: Date.now() };
  }
}
