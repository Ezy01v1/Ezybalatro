import { StyleSheet, View } from 'react-native';
import { formatMoney } from '@/game/format';
import type { RoundSummary } from '@/game/store';
import { es } from '@/i18n/es';
import { colors, spacing } from '@/theme/tokens';
import { Button, Text } from '@/ui/primitives';
import { Sheet } from './Sheet';

function Line({ label, amount, strong }: { label: string; amount: number; strong?: boolean }) {
  return (
    <View style={[styles.line, strong && styles.total]} accessible>
      <Text variant={strong ? 'subtitle' : 'body'} tone={strong ? 'fg' : 'muted'}>
        {label}
      </Text>
      <Text variant={strong ? 'numeric' : 'bodyMedium'} tone="money">
        {formatMoney(amount)}
      </Text>
    </View>
  );
}

export function RoundWonSheet({
  summary,
  onContinue,
}: {
  summary: RoundSummary | null;
  onContinue: () => void;
}) {
  return (
    <Sheet visible={!!summary} title={es.roundWon.title} testID="round-won">
      {summary ? (
        <>
          <Line label={es.roundWon.reward} amount={summary.blindReward} />
          {summary.handsLeftBonus > 0 ? (
            <Line
              label={es.roundWon.handsLeft(summary.handsLeft)}
              amount={summary.handsLeftBonus}
            />
          ) : null}
          {summary.interest > 0 ? (
            <Line label={es.roundWon.interest} amount={summary.interest} />
          ) : null}
          {summary.jokerMoney > 0 ? (
            <Line label={es.roundWon.jokers} amount={summary.jokerMoney} />
          ) : null}
          <Line label={es.roundWon.total} amount={summary.total} strong />
          <Button testID="to-shop-button" label={es.roundWon.toShop} onPress={onContinue} />
        </>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  total: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
});
