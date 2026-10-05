import type { RunState } from '@naipes/engine';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { formatNumber } from '@/game/format';
import { es } from '@/i18n/es';
import { colors, layout, radii, spacing } from '@/theme/tokens';
import { Button, DecoRule, Screen, Text } from '@/ui/primitives';

export function RunOverScreen({
  run,
  onNewRun,
  onReplay,
  onHome,
}: {
  run: RunState;
  onNewRun: () => void;
  onReplay: () => void;
  onHome: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const won = run.status === 'won';
  return (
    <Screen style={styles.screen}>
      <View style={styles.body} testID="run-over">
        <Text variant="display" tone={won ? 'primary' : 'fg'} center accessibilityRole="header">
          {won ? es.runOver.won : es.runOver.lost}
        </Text>
        <DecoRule />
        <Text variant="subtitle" center>
          {es.runOver.reached(run.ante)}
        </Text>
        <View style={styles.stat}>
          <Text variant="caption" tone="muted">
            {es.runOver.bestHand}
          </Text>
          <Text variant="scoreXL">{formatNumber(run.bestHandScore)}</Text>
        </View>
        <View
          style={styles.seedBox}
          accessible
          accessibilityLabel={`${es.runOver.seed}: ${run.seed}`}
        >
          <Text variant="caption" tone="muted">
            {es.runOver.seed}
          </Text>
          <Text variant="title" tone="primary" selectable testID="run-seed">
            {run.seed}
          </Text>
        </View>
        <Button
          variant="ghost"
          label={copied ? es.runOver.copied : es.runOver.copySeed}
          onPress={() => {
            void Clipboard.setStringAsync(run.seed).then(() => setCopied(true));
          }}
        />
      </View>
      <View style={styles.actions}>
        <Button label={es.runOver.newRun} onPress={onNewRun} />
        <Button variant="secondary" label={es.runOver.replaySeed} onPress={onReplay} />
        <Button variant="ghost" label={es.runOver.home} onPress={onHome} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { justifyContent: 'space-between' },
  body: { padding: layout.gutter, gap: spacing.lg, marginTop: spacing.xxl },
  stat: { alignItems: 'center', gap: spacing.xs },
  seedBox: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  actions: { padding: layout.gutter, gap: spacing.sm },
});
