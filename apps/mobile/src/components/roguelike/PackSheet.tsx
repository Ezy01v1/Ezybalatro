import type { OpenPack, RunState } from '@naipes/engine';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { CardFace } from '@/components/shared/CardFace';
import { Sheet } from '@/components/shared/Sheet';
import { haptics, playSound } from '@/feedback/feedback';
import { useGame } from '@/game/store';
import {
  CONSUMABLE_TEXTS,
  ENHANCEMENT_TEXTS,
  es,
  JOKER_TEXTS,
  PACK_TEXTS,
  RANK_NAMES,
  SUIT_NAMES,
} from '@/i18n/es';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';
import { Button, Text } from '@/ui/primitives';
import { useArmed } from '@/ui/useArmed';

/** The option list scrolls inside this share of the window: header, error and Saltar stay put. */
const LIST_MAX_SHARE = 0.55;

type PackItem = OpenPack['items'][number];

/** What a player reads about an option: its name, what it does and (for cards) what it adds. */
function describe(item: PackItem): { name: string; description: string; note?: string } {
  if (item.kind === 'joker') {
    const text = JOKER_TEXTS[item.jokerId];
    return { name: text?.name ?? item.jokerId, description: text?.description ?? '' };
  }
  if (item.kind === 'consumable') {
    const text = CONSUMABLE_TEXTS[item.consumableId];
    return {
      name: text?.name ?? item.consumableId,
      description: text ? `${text.kind}. ${text.description}` : '',
    };
  }
  const enhancement = ENHANCEMENT_TEXTS[item.enhancement];
  return {
    name: es.packs.cardItem(RANK_NAMES[item.rank], SUIT_NAMES[item.suit]),
    description: enhancement ? `${enhancement.name}: ${enhancement.description}` : '',
    note: enhancement?.name,
  };
}

/** The small picture at the left of an option. Each kind has its own shape, not just its own color. */
function Thumb({ item }: { item: PackItem }) {
  if (item.kind === 'card') return <CardFace card={item} size="pack" />;
  const short =
    item.kind === 'joker'
      ? (JOKER_TEXTS[item.jokerId]?.short ?? item.jokerId)
      : (CONSUMABLE_TEXTS[item.consumableId]?.short ?? item.consumableId);
  return (
    <View style={[styles.thumb, item.kind === 'joker' ? styles.jokerThumb : styles.ticketThumb]}>
      <Text
        variant="caption"
        center
        numberOfLines={2}
        maxFontSizeMultiplier={layout.fixedBoxFontScale}
      >
        {short}
      </Text>
    </View>
  );
}

function PackItemRow({
  item,
  index,
  error,
  onPress,
}: {
  item: PackItem;
  index: number;
  error: boolean;
  onPress: () => void;
}) {
  const { name, description } = describe(item);
  return (
    <Pressable
      testID={`pack-item-${index}`}
      accessibilityRole="button"
      accessibilityLabel={`${name}: ${description}${item.kind === 'card' ? `. ${es.packs.cardNote}` : ''}${item.taken ? ', elegido' : ''}`}
      accessibilityHint={item.taken ? undefined : es.packs.pickHint}
      accessibilityState={{ disabled: item.taken, selected: item.taken }}
      onPress={item.taken ? undefined : onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && !item.taken && styles.rowPressed,
        item.taken && styles.rowTaken,
        error && styles.rowError,
      ]}
    >
      <Thumb item={item} />
      <View style={styles.rowText}>
        <Text variant="bodyMedium" numberOfLines={2}>
          {name}
        </Text>
        <Text variant="caption" tone="muted">
          {description}
        </Text>
        {item.taken ? (
          <Text variant="caption" style={styles.takenLabel}>
            {es.packs.taken}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * The open pack, over the shop. It cannot be dismissed: the player picks or skips. Shown whenever
 * the run has an open pack, so it comes back after the app was closed. `onPicked` tells the shop
 * what was just added, for its notice.
 */
export function PackSheet({
  run,
  onPicked,
}: {
  run: RunState;
  onPicked: (message: string) => void;
}) {
  const pickFromPack = useGame((s) => s.pickFromPack);
  const skipPack = useGame((s) => s.skipPack);
  const { height } = useWindowDimensions();
  const [error, setError] = useState<{ index: number; message: string } | null>(null);
  const [armedSkip, setArmedSkip] = useArmed();
  const open = run.openPack;
  if (!open) return null;

  // Every pick takes one option, so the picks made plus the picks left is the pack's total.
  const picked = open.items.filter((item) => item.taken).length;
  const total = picked + open.picksLeft;
  const nothingPicked = picked === 0;
  const hasCard = open.items.some((item) => item.kind === 'card');

  const onPick = (index: number) => {
    const item = open.items[index]!;
    const code = pickFromPack(index);
    if (code === null) {
      setError(null);
      playSound('select');
      haptics.select();
      const { name, note } = describe(item);
      onPicked(
        item.kind === 'card'
          ? es.packs.cardAdded(note ? `${name}, ${note}` : name)
          : es.packs.added(name),
      );
      return;
    }
    haptics.limit();
    setError({
      index,
      message:
        code === 'NO_JOKER_SLOT'
          ? es.packs.errors.noJokerSlot
          : code === 'NO_CONSUMABLE_SLOT'
            ? es.packs.errors.noConsumableSlot
            : es.packs.errors.generic,
    });
  };

  const onSkip = () => {
    if (nothingPicked && !armedSkip) return setArmedSkip(true);
    setArmedSkip(null);
    skipPack();
  };

  return (
    <Sheet visible title={es.packs.pick(total, open.picksLeft)} testID="pack-sheet">
      <Text variant="caption" tone="muted" center>
        {PACK_TEXTS[open.packId]?.name ?? open.packId}
      </Text>
      {hasCard ? (
        <Text variant="caption" tone="muted" center>
          {es.packs.cardNote}
        </Text>
      ) : null}
      <ScrollView
        style={{ maxHeight: height * LIST_MAX_SHARE }}
        contentContainerStyle={styles.list}
        indicatorStyle="white"
        persistentScrollbar
      >
        {open.items.map((item, index) => (
          <PackItemRow
            key={index}
            item={item}
            index={index}
            error={error?.index === index}
            onPress={() => onPick(index)}
          />
        ))}
      </ScrollView>
      <View style={styles.errorSlot}>
        <Text
          testID="pack-error"
          variant="caption"
          tone="danger"
          accessibilityLiveRegion="assertive"
        >
          {error?.message ?? ''}
        </Text>
      </View>
      <Button
        testID="pack-skip"
        variant="secondary"
        label={
          nothingPicked ? (armedSkip ? es.packs.skipConfirm : es.packs.skip) : es.packs.skipRest
        }
        onPress={onSkip}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: layout.packRow.minHeight,
    padding: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.secondaryPressed },
  rowTaken: { opacity: 0.7, borderColor: colors.primary },
  rowError: { borderColor: colors.danger },
  rowText: { flex: 1, gap: spacing.xxs },
  takenLabel: { fontWeight: '700' },
  thumb: {
    width: layout.packThumb.width,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxs,
    backgroundColor: colors.surface,
    borderWidth: 1,
  },
  jokerThumb: {
    height: layout.packThumb.height,
    borderRadius: radii.md,
    borderColor: colors.primary,
  },
  ticketThumb: { height: 40, borderRadius: radii.sm, borderColor: colors.chips },
  // Two lines reserved, so showing the error never moves the list or the skip button.
  errorSlot: {
    minHeight: typography.caption.lineHeight * 2 + spacing.xs,
    justifyContent: 'center',
  },
});
