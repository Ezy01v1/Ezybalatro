import type { WalletPort } from './ports';

function assertAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new RangeError(`Invalid chip amount: ${amount}`);
  }
}

/** Dev wallet: each user starts with `initial` the first time they are touched. */
export class InMemoryWallet implements WalletPort {
  private readonly balances = new Map<string, number>();

  constructor(private readonly initial: number) {}

  private get(userId: string): number {
    let value = this.balances.get(userId);
    if (value === undefined) {
      value = this.initial;
      this.balances.set(userId, value);
    }
    return value;
  }

  async balance(userId: string): Promise<number> {
    return this.get(userId);
  }

  async debit(userId: string, amount: number): Promise<boolean> {
    assertAmount(amount);
    const current = this.get(userId);
    if (current < amount) return false;
    this.balances.set(userId, current - amount);
    return true;
  }

  async credit(userId: string, amount: number): Promise<void> {
    assertAmount(amount);
    this.balances.set(userId, this.get(userId) + amount);
  }

  total(): number {
    let sum = 0;
    for (const v of this.balances.values()) sum += v;
    return sum;
  }
}

/** Bots' bankroll: unlimited debits; tracks chips currently out with bots. */
export class HouseBankroll implements WalletPort {
  private out = 0;

  get outstanding(): number {
    return this.out;
  }

  async balance(): Promise<number> {
    return Number.MAX_SAFE_INTEGER;
  }

  async debit(_userId: string, amount: number): Promise<boolean> {
    assertAmount(amount);
    this.out += amount;
    return true;
  }

  async credit(_userId: string, amount: number): Promise<void> {
    assertAmount(amount);
    this.out -= amount;
  }
}
