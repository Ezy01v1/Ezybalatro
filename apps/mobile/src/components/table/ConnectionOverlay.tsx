import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Sheet } from '@/components/shared/Sheet';
import { es } from '@/i18n/es';
import type { TableStatus } from '@/table/tableStore';
import { colors, spacing } from '@/theme/tokens';
import { Button, Text } from '@/ui/primitives';
import { CardBack } from './Board';

const t = es.table;

/** Connection states over the table (design 4b §1 "Estados de conexión"). */
export function ConnectionOverlay({
  status,
  onCancel,
  onRetry,
  onExit,
}: {
  status: TableStatus;
  onCancel: () => void;
  onRetry: () => void;
  onExit: () => void;
}) {
  if (status === 'connecting' || status === 'waking' || status === 'idle') {
    return (
      <View style={styles.full} testID="connecting">
        <Fan />
        <Text variant="subtitle" center accessibilityLiveRegion="polite">
          {t.searching}
        </Text>
        {status === 'waking' ? (
          <>
            <Text tone="muted" center accessibilityLiveRegion="polite">
              {t.waking}
            </Text>
            <Button label={t.cancel} variant="ghost" onPress={onCancel} />
          </>
        ) : null}
      </View>
    );
  }
  if (status === 'reconnecting') {
    return (
      <View style={styles.band} testID="reconnecting" accessibilityLiveRegion="polite">
        <Text variant="bodyMedium" center>
          {t.reconnecting}
        </Text>
      </View>
    );
  }
  if (status === 'failed') {
    return (
      <Sheet visible title={t.menuTitle} testID="connect-failed">
        <View style={styles.sheetBody}>
          <Text center>{t.connectFailed}</Text>
          <Button label={t.retry} onPress={onRetry} />
          <Button label={t.backToMenu} variant="secondary" onPress={onExit} />
        </View>
      </Sheet>
    );
  }
  return null;
}

/** Deco fan that opens and closes while we look for a table (static with reduce motion). */
function Fan() {
  const reduced = useReducedMotion();
  const open = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    open.value = withRepeat(
      withSequence(withTiming(0.3, { duration: 700 }), withTiming(1, { duration: 700 })),
      -1,
    );
  }, [open, reduced]);
  return (
    <View style={styles.fan}>
      {[-12, 0, 12].map((deg) => (
        <FanCard key={deg} deg={deg} open={open} />
      ))}
    </View>
  );
}

function FanCard({ deg, open }: { deg: number; open: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${deg * open.value}deg` }] }));
  return (
    <Animated.View style={[styles.fanCard, style]}>
      <CardBack width={44} height={62} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  full: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
  },
  fan: { width: 80, height: 70, alignItems: 'center' },
  fanCard: { position: 'absolute' },
  band: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surfaceRaised,
    paddingVertical: spacing.sm,
  },
  sheetBody: { gap: spacing.md },
});
