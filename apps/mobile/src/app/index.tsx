import { useNetInfo } from '@react-native-community/netinfo';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { invalidateMe, lastKnownBalance, useMe } from '@/api/me';
import { BalanceBadge } from '@/components/menu/BalanceBadge';
import { ModeCard } from '@/components/menu/ModeCard';
import { useGame } from '@/game/store';
import { es } from '@/i18n/es';
import { colors, layout, spacing } from '@/theme/tokens';
import { Button, DecoRule, Screen, Text } from '@/ui/primitives';

export default function HomeScreen() {
  const run = useGame((s) => s.run);
  const saveStatus = useGame((s) => s.saveStatus);
  const startRun = useGame((s) => s.startRun);
  const canContinue = !!run && run.status === 'in_progress';

  const me = useMe();
  const online = useNetInfo().isConnected !== false;
  // undefined = still reading the cache, null = nothing cached yet.
  const [known, setKnown] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void lastKnownBalance().then((v) => {
      if (alive) setKnown(v);
    });
    return () => {
      alive = false;
    };
  }, [me.data]);

  // Coming back from the table the balance changed: refetch it (not on the first focus).
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (!firstFocus.current) void invalidateMe();
      firstFocus.current = false;
    }, []),
  );

  const balance = me.data?.balance ?? known ?? null;
  const loading = balance == null && (known === undefined || (me.isPending && online));
  const showWelcome = balance == null && !loading;

  return (
    <Screen>
      <View style={styles.top}>
        <BalanceBadge balance={balance} stale={!online && balance != null} />
        <Button
          testID="settings"
          variant="ghost"
          label={es.menu.settingsGlyph}
          accessibilityLabel={es.menu.settings}
          disabled
          style={styles.gear}
        />
      </View>
      <View style={styles.header}>
        <Text variant="display" tone="primary" center style={styles.title}>
          {es.appName}
        </Text>
        <DecoRule style={styles.rule} />
      </View>

      <View style={styles.cards}>
        <ModeCard title={es.home.roguelike} hint={es.menu.roguelikeHint}>
          {canContinue ? (
            <Text variant="caption" tone="muted">
              {es.menu.runInProgress(run.ante)}
            </Text>
          ) : null}
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
        </ModeCard>

        <ModeCard title={es.menu.tableTitle} hint={es.menu.tableHint}>
          {showWelcome ? (
            <Text variant="caption" tone="muted">
              {es.menu.welcomeChips}
            </Text>
          ) : null}
          {!online ? (
            <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
              {es.menu.offline}
            </Text>
          ) : null}
          <Button
            testID="quick-table"
            label={es.menu.quickTable}
            disabled={!online}
            onPress={() => router.push('/table')}
          />
        </ModeCard>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.md,
  },
  gear: { minWidth: 44, borderColor: colors.border },
  header: { paddingHorizontal: layout.gutter, paddingTop: spacing.lg, gap: spacing.sm },
  title: { fontSize: 48, lineHeight: 52 },
  rule: { marginHorizontal: spacing.xxl },
  cards: { paddingHorizontal: layout.gutter, paddingTop: spacing.xl, gap: spacing.lg },
});
