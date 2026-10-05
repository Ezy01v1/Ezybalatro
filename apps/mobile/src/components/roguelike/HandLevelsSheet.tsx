import { HAND_CATEGORIES, handBase, type RunState } from '@naipes/engine';
import { StyleSheet, View } from 'react-native';
import { formatNumber } from '@/game/format';
import { useGame } from '@/game/store';
import { es, HAND_NAMES } from '@/i18n/es';
import { spacing } from '@/theme/tokens';
import { Button, Text } from '@/ui/primitives';
import { useArmed } from '@/ui/useArmed';
import { Sheet } from './Sheet';

/** Hand type → level, chips and mult (values from the engine), plus "abandon run". */
export function HandLevelsSheet({
  visible,
  run,
  onClose,
}: {
  visible: boolean;
  run: RunState;
  onClose: () => void;
}) {
  const abandon = useGame((s) => s.abandon);
  const [armed, setArmed] = useArmed();
  return (
    <Sheet visible={visible} title={es.game.handLevels} onClose={onClose}>
      {[...HAND_CATEGORIES].reverse().map((hand) => {
        const level = run.handLevels[hand];
        const base = handBase(hand, level);
        return (
          <View key={hand} style={styles.row} accessible>
            <Text variant="bodyMedium" style={styles.name}>
              {HAND_NAMES[hand]}
            </Text>
            <Text variant="caption" tone="muted" style={styles.level}>
              {es.game.levelShort(level)}
            </Text>
            <Text variant="bodyMedium" tone="chips" style={styles.num}>
              {formatNumber(base.chips)}
            </Text>
            <Text variant="body" tone="muted">
              ×
            </Text>
            <Text variant="bodyMedium" tone="mult" style={styles.num}>
              {formatNumber(base.mult)}
            </Text>
          </View>
        );
      })}
      <Button
        variant="ghost"
        label={armed ? es.game.abandonConfirm : es.game.abandon}
        onPress={() => {
          if (!armed) return setArmed(true);
          abandon();
          onClose();
        }}
      />
      <Button variant="secondary" label={es.game.close} onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  name: { flex: 1 },
  level: { width: 40 },
  num: { minWidth: 36, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
