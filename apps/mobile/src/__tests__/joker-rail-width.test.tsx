import type { JokerInstance } from '@naipes/engine';
import { render, screen } from '@testing-library/react-native';
import * as ReactNative from 'react-native';
import { JokerRail, railSlotWidth } from '@/components/roguelike/JokerRail';
import { layout, spacing } from '@/theme/tokens';

const GAP = spacing.sm;
/** The usable width of a screen: the window minus the screen padding on both sides. */
const usable = (window: number) => window - 2 * spacing.lg;
/** What the rail needs for `count` slots of width `w`. */
const needed = (count: number, w: number) => count * w + (count - 1) * GAP;

describe('railSlotWidth', () => {
  it('keeps the full size while the slots fit (5 slots at 360 px)', () => {
    expect(railSlotWidth(5, usable(360))).toBe(layout.jokerSlot.width);
  });

  it.each([6, 7, 8])('shrinks so %i slots still fit at 360 px', (count) => {
    const width = railSlotWidth(count, usable(360));
    expect(width).toBeLessThan(layout.jokerSlot.width);
    expect(needed(count, width)).toBeLessThanOrEqual(usable(360));
  });

  it('never goes below a tappable minimum', () => {
    expect(railSlotWidth(12, usable(360))).toBeGreaterThanOrEqual(30);
  });

  it('stays at the full size on a wide screen', () => {
    expect(railSlotWidth(6, usable(430))).toBe(layout.jokerSlot.width);
  });
});

describe('JokerRail at 360 px with more than five slots', () => {
  const joker = (n: number): JokerInstance => ({
    instanceId: `j${n}`,
    jokerId: 'ember',
    state: {},
  });

  it('sizes every slot, filled or empty, so the row fits the screen', async () => {
    ReactNative.Dimensions.set({ window: { width: 360, height: 800, scale: 2, fontScale: 1 } });
    await render(<JokerRail jokers={[1, 2, 3].map(joker)} slots={7} />);
    const expected = railSlotWidth(7, usable(360));
    const filled = screen.getByTestId('joker-j1');
    const flat = ReactNative.StyleSheet.flatten(filled.props.style) as { width: number };
    expect(flat.width).toBe(expected);
    const empties = screen.getAllByLabelText('Espacio vacío');
    expect(empties).toHaveLength(4);
    for (const empty of empties) {
      expect((ReactNative.StyleSheet.flatten(empty.props.style) as { width: number }).width).toBe(
        expected,
      );
    }
  });
});
