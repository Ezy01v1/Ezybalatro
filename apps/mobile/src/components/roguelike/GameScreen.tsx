import { findConsumable, isCardDebuffed, previewPlay, type RunState } from '@naipes/engine';
import { useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { haptics, playSound } from '@/feedback/feedback';
import { useGame } from '@/game/store';
import { es } from '@/i18n/es';
import { colors, layout, radii, spacing, touchTarget } from '@/theme/tokens';
import { Notice } from '@/ui/Notice';
import { DecoRule, Screen, Text } from '@/ui/primitives';
import { useArmed } from '@/ui/useArmed';
import { useTransientNotice } from '@/ui/useTransientNotice';
import { consumableErrorText } from './consumable-errors';
import { ConsumableSheet } from './ConsumableSheet';
import { ConsumableTray } from './ConsumableTray';
import {
  ActionBar,
  BlindBar,
  HandPreview,
  ScoreHeader,
  TargetingBar,
  TargetingPanel,
} from './GameHud';
import { HandFan } from './HandFan';
import { JokerDetailSheet } from './JokerDetailSheet';
import { JokerRail } from './JokerRail';
import { HandLevelsSheet } from './HandLevelsSheet';
import { ScoringStage } from './ScoringStage';
import { useScoringPlayback } from './useScoringPlayback';

/** How long "Solo puedes elegir 3" replaces the instruction. */
const LIMIT_HINT_MS = 1500;

export function GameScreen({ run }: { run: RunState }) {
  const selected = useGame((s) => s.selected);
  const playback = useGame((s) => s.playback);
  const pendingRun = useGame((s) => s.pendingRun);
  // While the "blind beaten" sheet is up, the header keeps showing the blind that was just won.
  const beaten = useGame((s) => s.roundSummary);
  const targeting = useGame((s) => s.targeting);
  const toggleCard = useGame((s) => s.toggleCard);
  const play = useGame((s) => s.play);
  const discard = useGame((s) => s.discard);
  const sortHand = useGame((s) => s.sortHand);
  const moveJoker = useGame((s) => s.moveJoker);
  const finishPlayback = useGame((s) => s.finishPlayback);
  const cancelTargeting = useGame((s) => s.cancelTargeting);
  const applyConsumable = useGame((s) => s.applyConsumable);
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = run.jokers.find((j) => j.instanceId === detailId) ?? null;
  const [levelsOpen, setLevelsOpen] = useState(false);
  const [consumableId, setConsumableId] = useState<string | null>(null);
  const [notice, showNotice] = useTransientNotice();
  const [limitHint, showLimitHint] = useTransientNotice(LIMIT_HINT_MS);
  // Both are tied to the exact selection they were made for: any change to the selection
  // (the store builds a new array each time) or leaving the mode invalidates them.
  const [failure, setFailure] = useState<{ text: string; selection: string[] } | null>(null);
  const [armedSelection, setArmedSelection] = useArmed<string[]>();
  const applyError = failure?.selection === selected ? failure.text : null;
  const armedApply = armedSelection === selected;

  // Card-picking mode. Never while a hand is being counted.
  const picking = targeting && !playback ? targeting : null;
  const pickedInstance = picking
    ? run.consumables.find((c) => c.instanceId === picking.instanceId)
    : undefined;
  const pickedDef = pickedInstance ? findConsumable(pickedInstance.consumableId) : undefined;
  // Destroying cards cannot be undone: the consumable's data says which ones do it.
  const destroys = !!pickedDef?.ops.some((op) => op.op === 'destroyCards');

  const view = useScoringPlayback(playback, () => {
    if (pendingRun?.status === 'lost') playSound('lose');
    else if (pendingRun && pendingRun.phase !== 'blind') {
      haptics.win();
      playSound('win');
    }
    finishPlayback();
  });

  // The Android Back button leaves the mode instead of leaving the screen.
  useEffect(() => {
    if (!targeting) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      cancelTargeting();
      return true;
    });
    return () => subscription.remove();
  }, [targeting, cancelTargeting]);

  const preview = useMemo(
    () =>
      previewPlay(
        run,
        run.hand.filter((c) => selected.includes(c.id)).map((c) => c.id),
      ),
    [run, selected],
  );
  const debuffedIds = useMemo(
    () => new Set(run.hand.filter((c) => isCardDebuffed(run, c)).map((c) => c.id)),
    [run],
  );

  const onToggle = (cardId: string) => {
    const result = toggleCard(cardId);
    if (result === 'limit') {
      haptics.limit();
      if (pickedDef?.targets) showLimitHint(es.consumables.targeting.limit(pickedDef.targets.max));
    } else {
      haptics.select();
      playSound('select');
    }
  };

  const onApply = () => {
    if (!picking || !pickedInstance) return;
    if (destroys && !armedApply) return setArmedSelection(selected);
    const code = applyConsumable(picking.instanceId);
    if (code) {
      haptics.limit();
      setFailure({
        text: consumableErrorText(code, run, pickedInstance.consumableId, selected.length),
        selection: selected,
      });
      setArmedSelection(null);
      return;
    }
    haptics.select();
    playSound('deal');
  };

  const playedCards = playback ? run.hand.filter((c) => playback.playedIds.includes(c.id)) : [];
  const handCards = playback
    ? run.hand.filter((c) => !playback.playedIds.includes(c.id))
    : run.hand;
  const displayScore = view?.finished ? playback!.roundScore : run.roundScore;

  return (
    <Screen>
      <BlindBar
        ante={beaten?.ante ?? run.ante}
        blind={beaten?.blind ?? run.blind}
        bossId={(beaten?.blind ?? run.blind) === 'boss' ? run.bossId : null}
        money={run.money}
        onOpenLevels={() => setLevelsOpen(true)}
      />
      <ScoreHeader
        score={beaten?.roundScore ?? displayScore}
        target={beaten?.target ?? run.target}
      />
      <DecoRule style={styles.rule} />
      <View
        style={[styles.jokers, picking && styles.dimmed]}
        pointerEvents={picking ? 'none' : 'auto'}
      >
        <JokerRail
          jokers={run.jokers}
          slots={run.config.jokerSlots}
          pulses={view?.jokerPulses}
          labels={view?.jokerLabels}
          onPressJoker={setDetailId}
          onMove={moveJoker}
        />
      </View>

      <View style={styles.playArea}>
        <Pressable
          style={styles.playZone}
          onPress={view ? view.skip : undefined}
          accessibilityHint={view ? es.game.skip : undefined}
          disabled={!view}
        >
          {playback && view ? (
            <>
              <HandPreview
                handType={playback.handType}
                chips={view.chips}
                mult={view.mult}
                score={view.finished ? playback.score : null}
              />
              <ScoringStage
                cards={playedCards}
                scoringIds={playback.scoringIds}
                pulses={view.cardPulses}
                labels={view.cardLabels}
              />
            </>
          ) : picking && pickedInstance ? (
            <TargetingPanel
              consumableId={pickedInstance.consumableId}
              count={selected.length}
              error={applyError}
              limitHit={limitHint !== null}
            />
          ) : (
            <HandPreview
              handType={preview?.handType ?? null}
              level={preview?.level}
              chips={preview?.chips}
              mult={preview?.mult}
            />
          )}
        </Pressable>
        {notice ? (
          <View style={styles.noticeAnchor} pointerEvents="none">
            <Notice message={notice} />
          </View>
        ) : null}
      </View>

      <View style={styles.tools}>
        <View style={styles.sort} accessibilityLabel={es.game.sortLabel}>
          {(['rank', 'suit'] as const).map((by, i) => (
            <Pressable
              key={by}
              testID={`sort-${by}`}
              accessibilityRole="button"
              onPress={() => sortHand(by)}
              disabled={!!playback}
              style={[styles.sortItem, i === 0 ? styles.sortLeft : styles.sortRight]}
              hitSlop={6}
            >
              <Text variant="caption">{by === 'rank' ? es.game.sortRank : es.game.sortSuit}</Text>
            </Pressable>
          ))}
        </View>
        <ConsumableTray
          run={run}
          onPress={setConsumableId}
          disabled={!!playback || !!beaten || !!targeting}
          activeId={targeting?.instanceId ?? null}
        />
        <Text variant="caption" tone="muted" maxFontSizeMultiplier={layout.fixedBoxFontScale}>
          {es.game.deck(run.drawPile.length)}
        </Text>
      </View>
      <View style={styles.hand}>
        <HandFan
          cards={handCards}
          selected={selected}
          debuffedIds={debuffedIds}
          onToggle={onToggle}
        />
      </View>
      {picking && pickedDef?.targets ? (
        <TargetingBar
          count={selected.length}
          min={pickedDef.targets.min}
          max={pickedDef.targets.max}
          confirming={destroys && armedApply}
          onApply={onApply}
          onCancel={cancelTargeting}
        />
      ) : (
        <ActionBar
          handsLeft={run.handsLeft}
          discardsLeft={run.discardsLeft}
          selectedCount={selected.length}
          busy={!!playback}
          onPlay={play}
          onDiscard={() => {
            playSound('deal');
            discard();
          }}
        />
      )}
      <JokerDetailSheet joker={detail} onClose={() => setDetailId(null)} />
      <HandLevelsSheet visible={levelsOpen} run={run} onClose={() => setLevelsOpen(false)} />
      <ConsumableSheet
        run={run}
        instanceId={consumableId}
        onClose={() => setConsumableId(null)}
        onUsed={showNotice}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  rule: { marginHorizontal: layout.gutter, marginBottom: spacing.sm },
  jokers: { paddingHorizontal: layout.gutter, paddingTop: spacing.md },
  dimmed: { opacity: 0.5 },
  playArea: { flex: 1, minHeight: 104 },
  playZone: { flex: 1, justifyContent: 'center', gap: spacing.sm },
  noticeAnchor: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  tools: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touchTarget,
    paddingHorizontal: layout.gutter,
  },
  sort: { flexDirection: 'row' },
  sortItem: {
    minHeight: 36,
    minWidth: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  sortLeft: { borderTopLeftRadius: radii.pill, borderBottomLeftRadius: radii.pill },
  sortRight: {
    borderTopRightRadius: radii.pill,
    borderBottomRightRadius: radii.pill,
    borderLeftWidth: 0,
  },
  hand: { paddingHorizontal: layout.gutter },
});
