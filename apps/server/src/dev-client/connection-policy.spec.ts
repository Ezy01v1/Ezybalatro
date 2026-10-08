import { connectErrorAction, disconnectAction } from './connection-policy';

describe('connectErrorAction', () => {
  it('exits when the first connection fails', () => {
    expect(connectErrorAction({ everConnected: false, message: 'websocket error' })).toBe('exit');
  });

  it('retries a failed reconnect after having been connected', () => {
    expect(connectErrorAction({ everConnected: true, message: 'websocket error' })).toBe('retry');
  });

  it('exits on UNAUTHORIZED even after having been connected', () => {
    expect(connectErrorAction({ everConnected: true, message: 'UNAUTHORIZED' })).toBe('exit');
  });
});

describe('disconnectAction', () => {
  const base = { leaving: false, done: false };

  it('lets socket.io reconnect after transport loss', () => {
    expect(disconnectAction({ ...base, reason: 'transport close' })).toBe('auto');
    expect(disconnectAction({ ...base, reason: 'ping timeout' })).toBe('auto');
  });

  it('reconnects by hand after a server-initiated disconnect', () => {
    expect(disconnectAction({ ...base, reason: 'io server disconnect' })).toBe('manual');
  });

  it('never reconnects after our own close, leave or exit', () => {
    expect(disconnectAction({ ...base, reason: 'io client disconnect' })).toBe('none');
    expect(disconnectAction({ ...base, leaving: true, reason: 'transport close' })).toBe('none');
    expect(disconnectAction({ ...base, done: true, reason: 'io server disconnect' })).toBe('none');
  });
});
