import { FakeScheduler } from './fake-scheduler';

describe('FakeScheduler', () => {
  it('starts at 0 and runs timers in due order, setting now', async () => {
    const s = new FakeScheduler();
    const log: Array<[string, number]> = [];
    s.schedule(200, () => log.push(['b', s.now()]));
    s.schedule(100, () => log.push(['a', s.now()]));
    expect(s.now()).toBe(0);
    await s.advance(300);
    expect(log).toEqual([
      ['a', 100],
      ['b', 200],
    ]);
    expect(s.now()).toBe(300);
  });

  it('cancel prevents execution', async () => {
    const s = new FakeScheduler();
    const fn = jest.fn();
    s.schedule(100, fn).cancel();
    await s.advance(500);
    expect(fn).not.toHaveBeenCalled();
  });

  it('same-instant timers run in scheduling order', async () => {
    const s = new FakeScheduler();
    const log: number[] = [];
    s.schedule(100, () => log.push(1));
    s.schedule(100, () => log.push(2));
    await s.advance(100);
    expect(log).toEqual([1, 2]);
  });

  it('runs timers scheduled during advance that fall inside the window', async () => {
    const s = new FakeScheduler();
    const log: number[] = [];
    s.schedule(100, () => {
      log.push(s.now());
      s.schedule(50, () => log.push(s.now()));
    });
    await s.advance(200);
    expect(log).toEqual([100, 150]);
  });

  it('does not run timers beyond the window', async () => {
    const s = new FakeScheduler();
    const fn = jest.fn();
    s.schedule(300, fn);
    await s.advance(299);
    expect(fn).not.toHaveBeenCalled();
    await s.advance(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
