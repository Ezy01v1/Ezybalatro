import { DevIdentity } from './identity';

describe('DevIdentity', () => {
  it('DevIdentity accepts dev:ana and rejects bad names, missing tokens and production', async () => {
    const dev = new DevIdentity('development');
    await expect(dev.authenticate({ token: 'dev:ana' })).resolves.toEqual({
      userId: 'dev:ana',
      displayName: 'ana',
    });
    await expect(dev.authenticate({ token: 'dev:Beto_99' })).resolves.toEqual({
      userId: 'dev:Beto_99',
      displayName: 'Beto_99',
    });
    await expect(new DevIdentity('test').authenticate({ token: 'dev:ana' })).resolves.toEqual({
      userId: 'dev:ana',
      displayName: 'ana',
    });

    for (const auth of [
      { token: 'dev:an' }, // too short
      { token: `dev:${'a'.repeat(21)}` }, // too long
      { token: 'dev:ana maria' },
      { token: 'dev:añá' },
      { token: 'dev:' },
      { token: 'ana' },
      { token: 'bot:ana' },
      { token: ' dev:ana' },
      { token: 'dev:ana\n' },
      { token: 42 },
      { token: null },
      {},
      null,
      undefined,
      'dev:ana',
    ]) {
      await expect(dev.authenticate(auth)).resolves.toBeNull();
    }

    await expect(
      new DevIdentity('production').authenticate({ token: 'dev:ana' }),
    ).resolves.toBeNull();
  });
});
