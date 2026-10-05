import { isCardDebuffed, previewPlay, type RunState } from '@naipes/engine';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { haptics, playSound } from '@/game/feedback';
import { useGame } from '@/game/store';
import { es } from '@/i18n/es';
import { colors, layout, radii, spacing } from '@/theme/tokens';
import { DecoRule, Screen, Text } from '@/ui/primitives';
import { ActionBar, BlindBar, HandPreview, ScoreHeader } from './GameHud';
import { HandFan } from './HandFan';
import { JokerDetailSheet } from './JokerDetailSheet';
import { JokerRail } from './JokerRail';
import { HandLevelsSheet } from './HandLevelsSheet';
import { ScoringStage } from './ScoringStage';
import { useScoringPlayback } from './useScoringPlayback';

export function GameScreen({ run }: { run: RunState }) {
  const selected = useGame((s) => s.selected);
  const playback = useGame((s) => s.playback);
  const pendingRun = useGame((s) => s.pendingRun);
  // While the "blind beaten" sheet is up, the header keeps showing the blind that was just won.
  const beaten = useGame((s) => s.roundSummary);
  const toggleCard = useGame((s) => s.toggleCard);
  const play = useGame((s) => s.play);
  const discard = useGame((s) => s.discard);
  const sortHand = useGame((s) => s.sortHand);
  const moveJoker = useGame((s) => s.moveJoker);
  const finishPlayback = useGame((s) => s.finishPlayback);
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = run.jokers.find((j) => j.instanceId === detailId) ?? null;
  const [levelsOpen, setLevelsOpen] = useState(false);

  const view = useScoringPlayback(playback, () => {
    if (pendingRun?.status === 'lost') playSound('lose');
    else if (pendingRun && pendingRun.phase !== 'blind') {
      haptics.win();
      playSound('win');
    }
    finishPlayback();
  });

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
    if (result === 'limit') haptics.limit();
    else {
      haptics.select();
      playSound('select');
    }
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
      <View style={styles.jokers}>
        <JokerRail
          jokers={run.jokers}
          slots={run.config.jokerSlots}
          pulses={view?.jokerPulses}
          labels={view?.jokerLabels}
          onPressJoker={setDetailId}
          onMove={moveJoker}
        />
      </View>

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
        ) : (
          <HandPreview
            handType={preview?.handType ?? null}
            level={preview?.level}
            chips={preview?.chips}
            mult={preview?.mult}
          />
        )}
      </Pressable>

      <View style={styles.handHeader}>
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
        <Text variant="caption" tone="muted">
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
      <JokerDetailSheet joker={detail} onClose={() => setDetailId(null)} />
      <HandLevelsSheet visible={levelsOpen} run={run} onClose={() => setLevelsOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  rule: { marginHorizontal: layout.gutter, marginBottom: spacing.sm },
  jokers: { paddingHorizontal: layout.gutter, paddingTop: spacing.md },
  playZone: { flex: 1, justifyContent: 'center', gap: spacing.sm, minHeight: 120 },
  handHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: layout.gutter,
  },
  sort: { flexDirection: 'row' },
  sortItem: {
    minHeight: 36,
    minWidth: 64,
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
