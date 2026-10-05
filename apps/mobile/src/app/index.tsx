import { ENGINE_VERSION } from '@naipes/engine';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useGame } from '@/game/store';
import { es } from '@/i18n/es';
import { colors, layout, radii, spacing } from '@/theme/tokens';
import { Button, DecoRule, Screen, Text } from '@/ui/primitives';

export default function HomeScreen() {
  const run = useGame((s) => s.run);
  const saveStatus = useGame((s) => s.saveStatus);
  const startRun = useGame((s) => s.startRun);
  const canContinue = !!run && run.status === 'in_progress';

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="display" tone="primary" center style={styles.title}>
          {es.appName}
        </Text>
        <DecoRule style={styles.rule} />
        <Text variant="body" tone="muted" center>
          {es.home.subtitle}
        </Text>
      </View>

      <View style={styles.section}>
        <Text variant="subtitle">{es.home.roguelike}</Text>
        <Text variant="caption" tone="muted">
          {es.home.roguelikeHint}
        </Text>
        {saveStatus === 'corrupt' ? (
          <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
            {es.home.corruptSave}
          </Text>
        ) : null}
        {canContinue ? (
          <Button
            testID="continue-run"
            label={es.home.continueRun}
            accessibilityHint={es.home.continueHint(run.ante)}
            onPress={() => router.push('/run')}
          />
        ) : null}
        <Button
          testID="new-run"
          variant={canContinue ? 'secondary' : 'primary'}
          label={es.home.newRun}
          onPress={() => {
            startRun();
            router.push('/run');
          }}
        />
        <Button
          testID="seeded-run"
          variant="ghost"
          label={es.home.seededRun}
          onPress={() => router.push('/seed')}
        />
      </View>

      <View style={[styles.section, styles.table]}>
        <Text variant="subtitle">{es.home.table}</Text>
        <Text variant="caption" tone="muted">
          {es.home.tableHint}
        </Text>
      </View>

      <Text variant="caption" tone="muted" center style={styles.footer}>
        engine {ENGINE_VERSION}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: layout.gutter, paddingTop: spacing.xxl, gap: spacing.sm },
  title: { fontSize: 48, lineHeight: 52 },
  rule: { marginHorizontal: spacing.xxl },
  section: {
    marginHorizontal: layout.gutter,
    marginTop: spacing.xl,
    padding: spacing.lg,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  table: { opacity: 0.6 },
  footer: { marginTop: 'auto', paddingBottom: spacing.sm },
});
