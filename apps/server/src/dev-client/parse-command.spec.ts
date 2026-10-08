import { parseCommand } from './parse-command';

describe('parseCommand', () => {
  it.each([
    ['f', 'fold'],
    ['K', 'check'],
    ['c', 'call'],
    ['a', 'allIn'],
    ['  F  ', 'fold'],
  ])('parses %s', (line, type) => {
    expect(parseCommand(line)).toEqual({ kind: 'act', action: { type } });
  });

  it('parses b 120 and r 300 as integers', () => {
    expect(parseCommand('b 120')).toEqual({ kind: 'act', action: { type: 'bet', amount: 120 } });
    expect(parseCommand('R   300')).toEqual({ kind: 'act', action: { type: 'raise', to: 300 } });
  });

  it('parses the non-betting commands', () => {
    expect(parseCommand('sitout')).toEqual({ kind: 'sitOut' });
    expect(parseCommand('SitIn')).toEqual({ kind: 'sitIn' });
    expect(parseCommand('leave')).toEqual({ kind: 'leave' });
    expect(parseCommand('q')).toEqual({ kind: 'quit' });
  });

  it('rejects b without amount, b -5 and b 1.5', () => {
    for (const line of ['b', 'b -5', 'b 1.5', 'r', 'r abc', 'b 0', 'b 10 20']) {
      expect(parseCommand(line)).toEqual({ error: expect.any(String) });
    }
  });

  it('rejects unknown and empty input with a Spanish message', () => {
    expect(parseCommand('')).toEqual({ error: expect.any(String) });
    expect(parseCommand('xyz')).toEqual({ error: expect.stringContaining('Comando') });
    expect(parseCommand('f 10')).toEqual({ error: expect.any(String) });
  });
});
