import { jokerSellValue, type RunState, type ShopOffer } from '@naipes/engine';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { playSound } from '@/game/feedback';
import { formatMoney } from '@/game/format';
import { useGame } from '@/game/store';
import { BOSS_TEXTS, es, HAND_NAMES, JOKER_TEXTS } from '@/i18n/es';
import { colors, layout, radii, spacing } from '@/theme/tokens';
import { Button, DecoRule, Screen, Text } from '@/ui/primitives';
import { useArmed } from '@/ui/useArmed';
import { JokerDetailSheet } from './JokerDetailSheet';
import { JokerRail } from './JokerRail';

function OfferCard({
  offer,
  index,
  run,
  onBuy,
}: {
  offer: ShopOffer;
  index: number;
  run: RunState;
  onBuy: (index: number) => void;
}) {
  const title =
    offer.kind === 'joker'
      ? (JOKER_TEXTS[offer.jokerId]?.name ?? offer.jokerId)
      : es.shop.levelUp(HAND_NAMES[offer.handType]);
  const description =
    offer.kind === 'joker' ? (JOKER_TEXTS[offer.jokerId]?.description ?? '') : es.shop.levelUpDesc;
  const missing = offer.price - run.money;
  const full = offer.kind === 'joker' && run.jokers.length >= run.config.jokerSlots;
  const status = offer.sold
    ? es.shop.bought
    : full
      ? es.shop.full
      : missing > 0
        ? es.shop.missing(missing)
        : null;
  return (
    <View style={[styles.offer, offer.sold && styles.offerSold]} testID={`offer-${index}`}>
      <Text variant="subtitle">{title}</Text>
      <Text variant="caption" tone="muted">
        {description}
      </Text>
      <View style={styles.offerFooter}>
        <Text
          variant="caption"
          tone={missing > 0 && !offer.sold ? 'danger' : 'muted'}
          style={styles.status}
        >
          {status ?? ''}
        </Text>
        <Button
          testID={`buy-${index}`}
          label={es.shop.buy(offer.price)}
          inactive={!!status}
          onPress={status ? undefined : () => onBuy(index)}
          style={styles.buy}
        />
      </View>
    </View>
  );
}

export function ShopScreen({ run }: { run: RunState }) {
  const buy = useGame((s) => s.buy);
  const reroll = useGame((s) => s.reroll);
  const sellJoker = useGame((s) => s.sellJoker);
  const leaveShop = useGame((s) => s.leaveShop);
  const moveJoker = useGame((s) => s.moveJoker);
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = run.jokers.find((j) => j.instanceId === detailId) ?? null;
  const [armedSell, setArmedSell] = useArmed<string>();

  const onBuy = (index: number) => {
    if (buy(index) === null) playSound('coin');
  };
  const nextLabel =
    run.blind === 'boss' ? es.shop.nextBoss(BOSS_TEXTS[run.bossId]?.name ?? '') : es.shop.next;

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="display" accessibilityRole="header">
          {es.shop.title}
        </Text>
        <Text variant="numeric" tone="money">
          {formatMoney(run.money)}
        </Text>
      </View>
      <DecoRule style={styles.rule} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="caption" tone="muted">
          {es.shop.yourJokers}
        </Text>
        <JokerRail
          jokers={run.jokers}
          slots={run.config.jokerSlots}
          onPressJoker={setDetailId}
          onMove={moveJoker}
        />
        <Text variant="caption" tone="muted">
          {es.shop.jokers} · {es.shop.consumables}
        </Text>
        {run.shop.map((offer, index) => (
          <OfferCard
            key={`${index}-${offer.kind === 'joker' ? offer.jokerId : offer.handType}`}
            offer={offer}
            index={index}
            run={run}
            onBuy={onBuy}
          />
        ))}
        <Button
          testID="reroll-button"
          variant="secondary"
          label={es.shop.reroll(run.rerollCost)}
          inactive={run.money < run.rerollCost}
          onPress={run.money < run.rerollCost ? undefined : () => reroll()}
        />
      </ScrollView>
      <View style={styles.footer}>
        <Button
          testID="next-blind-button"
          label={nextLabel}
          onPress={leaveShop}
          style={styles.next}
        />
      </View>
      <JokerDetailSheet
        joker={detail}
        onClose={() => {
          setDetailId(null);
          setArmedSell(null);
        }}
        action={
          detail
            ? {
                testID: 'sell-button',
                label:
                  armedSell === detail.instanceId
                    ? es.shop.sellConfirm(jokerSellValue(detail))
                    : es.shop.sell(jokerSellValue(detail)),
                onPress: () => {
                  if (armedSell !== detail.instanceId) return setArmedSell(detail.instanceId);
                  sellJoker(detail.instanceId);
                  playSound('coin');
                  setDetailId(null);
                  setArmedSell(null);
                },
              }
            : undefined
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.md,
  },
  rule: { marginHorizontal: layout.gutter, marginVertical: spacing.sm },
  content: { paddingHorizontal: layout.gutter, gap: spacing.md, paddingBottom: spacing.xl },
  offer: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  offerSold: { opacity: 0.55 },
  offerFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  status: { flex: 1 },
  buy: { minWidth: 140 },
  footer: { paddingHorizontal: layout.gutter, paddingBottom: spacing.sm },
  next: { minHeight: layout.actionBarHeight },
});
