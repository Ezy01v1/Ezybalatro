import type { PlayerAction, TableUpdate } from '@naipes/shared';
import { useNetInfo } from '@react-native-community/netinfo';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, BackHandler, Pressable, StyleSheet, View } from 'react-native';
import type { StoreApi, UseBoundStore } from 'zustand';
import { formatNumber } from '@/game/format';
import { es } from '@/i18n/es';
import type { TableState } from '@/table/tableStore';
import { useTableEffects } from '@/table/useTableEffects';
import { quickAmounts, toTableModel } from '@/table/viewModel';
import { colors, spacing, touchTarget } from '@/theme/tokens';
import { Screen, Text } from '@/ui/primitives';
import { ActionBar } from './ActionBar';
import { BetSelector } from './BetSelector';
import { ConnectionOverlay } from './ConnectionOverlay';
import { HeroSeat } from './HeroSeat';
import { OvalTable } from './OvalTable';
import { TableDialogs, type TableDialog } from './TableDialogs';
import { TableMenu } from './TableMenu';
import { Toast } from './Toast';

const t = es.table;
const TICK_MS = 250;
const RESTART = new Set(['closed', 'failed', 'replaced']);

/** You hold live cards in a hand that is not settled: leaving folds them. */
export function inHandInProgress(update: TableUpdate | null): boolean {
  const hand = update?.view.hand;
  const mySeat = update?.view.mySeat ?? null;
  if (!hand || mySeat === null || hand.street === 'settled') return false;
  const me = hand.players.find((p) => p.seat === mySeat);
  return !!me && !me.folded;
}

export function TableScreen({
  useStore,
  balance,
  onExit,
}: {
  useStore: UseBoundStore<StoreApi<TableState>>;
  /** Wallet balance for the top bar, when known. */
  balance: number | null;
  onExit: () => void;
}) {
  const storeStatus = useStore((s) => s.status);
  // The socket only notices a dead network after its ping timeout; the OS knows at once.
  const offline = useNetInfo().isConnected === false;
  const status = offline && storeStatus === 'seated' ? 'reconnecting' : storeStatus;
  const update = useStore((s) => s.update);
  const receivedAt = useStore((s) => s.turnReceivedAt);
  const pending = useStore((s) => s.pendingAction);
  const toast = useStore((s) => s.toast);
  const leftWith = useStore((s) => s.leftWith);
  const prev = useStore((s) => s.prev);
  const store = useStore.getState;

  useTableEffects(update, prev);

  const [now, setNow] = useState(() => Date.now());
  const [betOpen, setBetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Mount: (re)start. After closed/failed/replaced the store must be reset first.
  useEffect(() => {
    const s = store();
    if (RESTART.has(s.status)) s.reset();
    store().start();
  }, [store]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => store().onAppState(st));
    return () => sub.remove();
  }, [store]);

  const turn = update?.turn ?? null;
  useEffect(() => {
    if (!turn) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [turn]);

  const model = useMemo(
    () => (update ? toTableModel(update, { now, receivedAt }) : null),
    [update, now, receivedAt],
  );
  const legal = update?.view.legal ?? null;
  const bar = model?.actionBar;
  const range = bar?.kind === 'turn' ? bar.right : null;
  // The picker only lives while it is your turn with a bet/raise available.
  const showBet = betOpen && range !== null;
  // A closed turn closes the picker for the next one too.
  if (betOpen && range === null) setBetOpen(false);

  const exit = useCallback(() => {
    store().reset();
    onExit();
  }, [store, onExit]);

  const requestLeave = useCallback(() => {
    setMenuOpen(false);
    if (inHandInProgress(store().update)) setConfirmLeave(true);
    else void store().leave();
  }, [store]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const s = store().status;
      if (s === 'seated' || s === 'reconnecting') requestLeave();
      else exit();
      return true;
    });
    return () => sub.remove();
  }, [store, requestLeave, exit]);

  const act = (action: PlayerAction) => {
    setBetOpen(false);
    void store().act(action);
  };

  let dialog: TableDialog | null = null;
  if (status === 'closed')
    dialog = leftWith !== null ? { kind: 'left', chips: leftWith } : { kind: 'closed' };
  else if (status === 'replaced') dialog = { kind: 'replaced' };
  else if (confirmLeave) dialog = { kind: 'leaveConfirm' };

  const blocked = pending || status !== 'seated';
  const hero = model?.hero ?? null;

  return (
    <Screen>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.menu}
          onPress={() => setMenuOpen(true)}
          disabled={!update}
          style={styles.menuButton}
        >
          <Text variant="title">⋮</Text>
        </Pressable>
        <Text variant="bodyMedium" center style={styles.blinds}>
          {model ? t.blinds(formatNumber(model.blinds.small), formatNumber(model.blinds.big)) : ''}
        </Text>
        <View style={styles.balance}>
          {balance !== null ? (
            <Text
              variant="bodyMedium"
              tone="money"
              accessibilityLabel={t.balanceA11y(formatNumber(balance))}
            >
              {formatNumber(balance)}
            </Text>
          ) : null}
        </View>
      </View>
      {model ? (
        <View style={[styles.body, status === 'reconnecting' && styles.dimmed]}>
          <OvalTable model={model} />
          {hero ? (
            <HeroSeat hero={hero} timer={model.timer?.seat === hero.seat ? model.timer : null} />
          ) : null}
          {showBet && range && legal ? (
            <BetSelector
              key={`${update?.view.hand?.handNumber}-${update?.view.hand?.street}-${range.type}-${range.min}-${range.max}`}
              range={range}
              quick={quickAmounts(
                legal,
                update?.view.hand?.pot ?? 0,
                update?.view.hand?.currentBet ?? 0,
              )}
              step={model.blinds.big}
              disabled={blocked}
              onConfirm={act}
              onCancel={() => setBetOpen(false)}
            />
          ) : null}
          {bar ? (
            <ActionBar
              model={bar}
              disabled={blocked}
              pending={pending}
              onAct={act}
              onOpenBet={() => setBetOpen(true)}
              onSitIn={() => void store().sitIn()}
            />
          ) : null}
        </View>
      ) : null}
      <ConnectionOverlay
        status={status}
        onCancel={exit}
        onRetry={() => store().retry()}
        onExit={exit}
      />
      <Toast message={toast} onDismiss={() => store().dismissToast()} />
      <TableMenu
        visible={menuOpen && status === 'seated'}
        sittingOut={hero?.state === 'sittingOut' || bar?.kind === 'sitIn'}
        onLeave={requestLeave}
        onToggleSitOut={() => {
          setMenuOpen(false);
          void (hero?.state === 'sittingOut' || bar?.kind === 'sitIn'
            ? store().sitIn()
            : store().sitOut());
        }}
        onClose={() => setMenuOpen(false)}
      />
      <TableDialogs
        dialog={dialog}
        onExit={exit}
        onFindAnother={() => {
          store().reset();
          store().start();
        }}
        onConfirmLeave={() => {
          setConfirmLeave(false);
          void store().leave();
        }}
        onCancelLeave={() => setConfirmLeave(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  menuButton: { width: touchTarget, height: touchTarget, justifyContent: 'center' },
  blinds: { flex: 1 },
  balance: { minWidth: touchTarget, alignItems: 'flex-end' },
  body: { flex: 1, backgroundColor: colors.bg },
  dimmed: { opacity: 0.5 },
});
