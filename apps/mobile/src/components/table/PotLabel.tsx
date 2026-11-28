import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { usePulseStyle } from './animations';
import { formatNumber } from '@/game/format';
import { es } from '@/i18n/es';
import { spacing } from '@/theme/tokens';
import { Text } from '@/ui/primitives';

/** "Bote 320 · Lateral 140", or "Sol gana 320" when the hand was won without a showdown. */
export function PotLabel({
  pots,
  winner,
}: {
  pots: { main: number; sides: number[] };
  winner: { name: string; amount: number } | null;
}) {
  // Hooks before any early return: the pot pulses when the street's chips join it.
  const pulse = usePulseStyle(pots.main);
  if (winner) {
    return (
      <Text variant="bodyMedium" tone="money" center testID="pot-label">
        {es.table.wins(winner.name, formatNumber(winner.amount))}
      </Text>
    );
  }
  if (pots.main <= 0 && pots.sides.length === 0) return <View style={styles.empty} />;
  const parts = [
    es.table.pot(formatNumber(pots.main)),
    ...pots.sides.map((n) => es.table.sidePot(formatNumber(n))),
  ];
  return (
    <Animated.View style={pulse}>
      <Text variant="numeric" tone="money" center testID="pot-label" style={styles.text}>
        {parts.join(' · ')}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  text: { paddingHorizontal: spacing.sm },
  empty: { height: 24 },
});
