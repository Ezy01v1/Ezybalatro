import { AccountDeletedError, type AccountKey } from '../accounts/account-port';
import { DevIdentity, SupabaseIdentity, createIdentity } from './identity';

const accounts = {
  ensureAccount: jest.fn(async (key: AccountKey) => `id-of-${'devHandle' in key ? key.devHandle : key.userId}`),
};

describe('DevIdentity', () => {
  it('DevIdentity accepts dev:ana and rejects bad names, missing tokens and production', async () => {
    const dev = new DevIdentity('development', accounts);
    await expect(dev.authenticate({ token: 'dev:ana' })).resolves.toEqual({
      userId: 'id-of-dev:ana',
      isGuest: false,
    });
    await expect(dev.authenticate({ token: 'dev:Beto_99' })).resolves.toEqual({
      userId: 'id-of-dev:Beto_99',
      isGuest: false,
    });
    await expect(new DevIdentity('test', accounts).authenticate({ token: 'dev:ana' })).resolves.toEqual({
      userId: 'id-of-dev:ana',
      isGuest: false,
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

    expect(accounts.ensureAccount).toHaveBeenCalledWith({ devHandle: 'dev:ana' });
    accounts.ensureAccount.mockClear();
    await expect(
      new DevIdentity('production', accounts).authenticate({ token: 'dev:ana' }),
    ).resolves.toBeNull();
    expect(accounts.ensureAccount).not.toHaveBeenCalled();
  });
});

const SUB = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const JWT = 'eyJhbGciOiJFUzI1NiJ9.e30.sig';

function makeAccounts(deleted = new Set<string>()) {
  return {
    ensureAccount: jest.fn(async (key: AccountKey) => {
      const id = 'devHandle' in key ? `id-of-${key.devHandle}` : key.userId;
      if (deleted.has(id)) throw new AccountDeletedError();
      return id;
    }),
    isDeleted: jest.fn(async (id: string) => deleted.has(id)),
  };
}

const verifierFor = (result: { sub: string; isAnonymous: boolean } | null) => ({
  verify: jest.fn(async (_token: string) => result),
});

describe('SupabaseIdentity', () => {
  it('maps a verified token to the profile (sub) and is_anonymous to isGuest', async () => {
    const accounts = makeAccounts();
    const verifier = verifierFor({ sub: SUB, isAnonymous: true });
    const id = new SupabaseIdentity(verifier, accounts);
    await expect(id.authenticate({ token: JWT })).resolves.toEqual({ userId: SUB, isGuest: true });
    expect(verifier.verify).toHaveBeenCalledWith(JWT);
    expect(accounts.ensureAccount).toHaveBeenCalledWith({ userId: SUB, isGuest: true });
  });

  it('rejects invalid tokens and malformed handshakes without touching accounts', async () => {
    const accounts = makeAccounts();
    const id = new SupabaseIdentity(verifierFor(null), accounts);
    for (const auth of [{ token: JWT }, { token: '' }, { token: 7 }, {}, null, JWT]) {
      await expect(id.authenticate(auth)).resolves.toBeNull();
    }
    expect(accounts.ensureAccount).not.toHaveBeenCalled();
  });

  it('rejects deleted profiles and never calls ensureAccount for them', async () => {
    const accounts = makeAccounts(new Set([SUB]));
    const id = new SupabaseIdentity(verifierFor({ sub: SUB, isAnonymous: false }), accounts);
    await expect(id.authenticate({ token: JWT })).resolves.toBeNull();
    expect(accounts.ensureAccount).not.toHaveBeenCalled();
  });

  it('rejects a profile deleted between the check and ensureAccount', async () => {
    const accounts = makeAccounts(new Set([SUB]));
    accounts.isDeleted.mockResolvedValueOnce(false);
    const id = new SupabaseIdentity(verifierFor({ sub: SUB, isAnonymous: false }), accounts);
    await expect(id.authenticate({ token: JWT })).resolves.toBeNull();
  });
});

describe('createIdentity', () => {
  const verifier = verifierFor({ sub: SUB, isAnonymous: false });

  it('without DEV_IDENTITY: JWTs only, dev: rejected', async () => {
    const accounts = makeAccounts();
    const id = createIdentity({ NODE_ENV: 'development', DEV_IDENTITY: false }, accounts, verifier);
    await expect(id.authenticate({ token: 'dev:ana' })).resolves.toBeNull();
    await expect(id.authenticate({ token: JWT })).resolves.toEqual({ userId: SUB, isGuest: false });
    expect(accounts.ensureAccount).not.toHaveBeenCalledWith({ devHandle: 'dev:ana' });
  });

  it('with DEV_IDENTITY outside production: dev: and JWTs', async () => {
    const accounts = makeAccounts();
    const id = createIdentity({ NODE_ENV: 'test', DEV_IDENTITY: true }, accounts, verifier);
    await expect(id.authenticate({ token: 'dev:ana' })).resolves.toEqual({ userId: 'id-of-dev:ana', isGuest: false });
    await expect(id.authenticate({ token: JWT })).resolves.toEqual({ userId: SUB, isGuest: false });
  });

  it('dev: is never sent to the verifier, and is rejected in production even if DEV_IDENTITY slipped through', async () => {
    const v = verifierFor({ sub: SUB, isAnonymous: false });
    const id = createIdentity({ NODE_ENV: 'production', DEV_IDENTITY: true }, makeAccounts(), v);
    await expect(id.authenticate({ token: 'dev:ana' })).resolves.toBeNull();
    expect(v.verify).not.toHaveBeenCalled();
  });

  it('with DEV_IDENTITY and no verifier (no SUPABASE_URL): JWTs are rejected', async () => {
    const id = createIdentity({ NODE_ENV: 'development', DEV_IDENTITY: true }, makeAccounts(), null);
    await expect(id.authenticate({ token: JWT })).resolves.toBeNull();
    await expect(id.authenticate({ token: 'dev:ana' })).resolves.not.toBeNull();
  });
});
