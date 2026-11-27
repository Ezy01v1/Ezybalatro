import {
  DEFAULT_CONTENT,
  findConsumable,
  jokerSellValue,
  type RunState,
  type ShopOffer,
} from '@naipes/engine';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { playSound } from '@/feedback/feedback';
import { formatMoney } from '@/game/format';
import { useGame } from '@/game/store';
import {
  BOSS_TEXTS,
  CONSUMABLE_TEXTS,
  es,
  JOKER_TEXTS,
  PACK_TEXTS,
  VOUCHER_TEXTS,
} from '@/i18n/es';
import { colors, layout, radii, spacing } from '@/theme/tokens';
import { Notice } from '@/ui/Notice';
import { Button, DecoRule, Screen, Text } from '@/ui/primitives';
import { useArmed } from '@/ui/useArmed';
import { useTransientNotice } from '@/ui/useTransientNotice';
import { ConsumableSheet } from './ConsumableSheet';
import { ConsumableTray } from './ConsumableTray';
import { DeckSheet } from './DeckSheet';
import { JokerDetailSheet } from './JokerDetailSheet';
import { JokerRail } from './JokerRail';
import { OfferRow } from './OfferRow';
import { VoucherPills } from './VoucherPills';

type BasicOffer = Extract<ShopOffer, { kind: 'joker' | 'consumable' }>;

type LootOffer = Extract<ShopOffer, { kind: 'pack' | 'voucher' }>;

/** Compact row of a pack or the voucher. The engine decides; this only explains what is missing. */
function LootRow({
  offer,
  index,
  run,
  onBuy,
}: {
  offer: LootOffer;
  index: number;
  run: RunState;
  onBuy: (index: number) => void;
}) {
  const isPack = offer.kind === 'pack';
  const packDef = isPack ? DEFAULT_CONTENT.packs.find((p) => p.id === offer.packId) : undefined;
  let text: { name: string; description: string };
  let line2: string;
  if (offer.kind === 'pack') {
    text = PACK_TEXTS[offer.packId] ?? { name: offer.packId, description: '' };
    line2 = packDef ? es.shop.packPick(packDef.size, packDef.picks) : '';
  } else {
    const voucher = VOUCHER_TEXTS[offer.voucherId];
    text = voucher ?? { name: offer.voucherId, description: '' };
    line2 = voucher?.short ?? offer.voucherId;
  }
  const noRoom =
    (packDef?.kind === 'joker' && run.jokers.length >= run.config.jokerSlots
      ? es.shop.noJokerSlot
      : null) ??
    (packDef?.kind === 'consumable' && run.consumables.length >= run.config.consumableSlots
      ? es.shop.noConsumableSlot
      : null);
  const missing = offer.price - run.money;
  const status = offer.sold
    ? es.shop.bought
    : (noRoom ?? (missing > 0 ? es.shop.missing(missing) : null));
  return (
    <OfferRow
      index={index}
      title={text.name}
      line2={line2}
      description={text.description}
      status={offer.sold ? null : status}
      statusTone="danger"
      price={offer.price}
      sold={offer.sold}
      inactive={!!status}
      emphasis={isPack ? undefined : 'voucher'}
      buyLabel={es.shop.buyA11y(text.name, offer.price)}
      onBuy={() => onBuy(index)}
    />
  );
}

function OfferCard({
  offer,
  index,
  run,
  onBuy,
}: {
  offer: BasicOffer;
  index: number;
  run: RunState;
  onBuy: (index: number) => void;
}) {
  const text =
    offer.kind === 'joker'
      ? (JOKER_TEXTS[offer.jokerId] ?? { name: offer.jokerId, description: '' })
      : (CONSUMABLE_TEXTS[offer.consumableId] ?? { name: offer.consumableId, description: '' });
  // Consumables that ask for cards can only be used in a blind: say so before buying.
  const where =
    offer.kind === 'consumable'
      ? findConsumable(offer.consumableId)?.targets
        ? es.consumables.whereBlind
        : es.consumables.whereAny
      : null;
  const missing = offer.price - run.money;
  const full =
    offer.kind === 'joker'
      ? run.jokers.length >= run.config.jokerSlots
      : run.consumables.length >= run.config.consumableSlots;
  const fullText = offer.kind === 'joker' ? es.shop.full : es.shop.fullConsumables;
  const status = offer.sold
    ? es.shop.bought
    : full
      ? fullText
      : missing > 0
        ? es.shop.missing(missing)
        : null;
  return (
    <View style={[styles.offer, offer.sold && styles.offerSold]} testID={`offer-${index}`}>
      <Text variant="subtitle">{text.name}</Text>
      <Text variant="caption" tone="muted">
        {text.description}
      </Text>
      {where ? (
        <Text variant="caption" tone="muted">
          {where}
        </Text>
      ) : null}
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
  const [consumableId, setConsumableId] = useState<string | null>(null);
  const [deckOpen, setDeckOpen] = useState(false);
  const [notice, showNotice] = useTransientNotice();

  const onBuy = (index: number) => {
    const offer = run.shop[index];
    const code = buy(index);
    if (code === null) {
      playSound(offer?.kind === 'pack' ? 'deal' : 'coin');
      if (offer?.kind === 'voucher')
        showNotice(es.shop.voucherBought(VOUCHER_TEXTS[offer.voucherId]?.short ?? offer.voucherId));
    } else if (code === 'NO_JOKER_SLOT') showNotice(es.shop.noJokerSlot);
    else if (code === 'NO_CONSUMABLE_SLOT')
      showNotice(offer?.kind === 'pack' ? es.shop.noConsumableSlot : es.consumables.errors.noSlot);
  };
  // Grouped on screen; the index (and test ids) stay the position in run.shop.
  const offers = run.shop.flatMap((offer, index) =>
    offer.kind === 'joker' || offer.kind === 'consumable' ? [{ offer, index }] : [],
  );
  const lootOffers = run.shop.flatMap((offer, index) =>
    offer.kind === 'pack' || offer.kind === 'voucher' ? [{ offer, index }] : [],
  );
  const packOffers = lootOffers.filter((o) => o.offer.kind === 'pack');
  const voucherOffers = lootOffers.filter((o) => o.offer.kind === 'voucher');
  const renderLoot = (list: typeof lootOffers) =>
    list.map(({ offer, index }) => (
      <LootRow
        key={`${index}-${offer.kind === 'pack' ? offer.packId : offer.voucherId}`}
        offer={offer}
        index={index}
        run={run}
        onBuy={onBuy}
      />
    ));
  const jokerOffers = offers.filter((o) => o.offer.kind === 'joker');
  const consumableOffers = offers.filter((o) => o.offer.kind === 'consumable');
  const renderOffers = (list: typeof offers) =>
    list.map(({ offer, index }) => (
      <OfferCard
        key={`${index}-${offer.kind === 'joker' ? offer.jokerId : offer.consumableId}`}
        offer={offer}
        index={index}
        run={run}
        onBuy={onBuy}
      />
    ));
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
        <View style={styles.trayHeader}>
          <Text variant="caption" tone="muted">
            {es.shop.yourConsumables}
          </Text>
          <Button
            testID="deck-open"
            variant="ghost"
            label={`${es.consumables.deck.open} · ${run.deck.length}`}
            accessibilityLabel={es.consumables.deck.openA11y(run.deck.length)}
            onPress={() => setDeckOpen(true)}
          />
        </View>
        <ConsumableTray run={run} variant="wide" onPress={setConsumableId} />
        <View style={styles.noticeSlot}>{notice ? <Notice message={notice} /> : null}</View>
        {jokerOffers.length > 0 ? (
          <>
            <Text variant="caption" tone="muted">
              {es.shop.jokers}
            </Text>
            {renderOffers(jokerOffers)}
          </>
        ) : null}
        {consumableOffers.length > 0 ? (
          <>
            <Text variant="caption" tone="muted">
              {es.shop.consumables}
            </Text>
            {renderOffers(consumableOffers)}
          </>
        ) : null}
        <View style={styles.rerollRow}>
          <Button
            testID="reroll-button"
            variant="secondary"
            label={es.shop.reroll(run.rerollCost)}
            inactive={run.money < run.rerollCost}
            onPress={run.money < run.rerollCost ? undefined : () => reroll()}
          />
          <Text variant="caption" tone="muted">
            {es.shop.rerollScope}
          </Text>
        </View>
        {packOffers.length > 0 ? (
          <>
            <Text variant="caption" tone="muted" accessibilityRole="header">
              {es.shop.packs}
            </Text>
            {renderLoot(packOffers)}
          </>
        ) : null}
        {voucherOffers.length > 0 ? (
          <>
            <Text variant="caption" tone="muted" accessibilityRole="header">
              {es.shop.voucher}
            </Text>
            {renderLoot(voucherOffers)}
          </>
        ) : null}
        <VoucherPills voucherIds={run.vouchers} />
      </ScrollView>
      <View style={styles.footer}>
        <Button
          testID="next-blind-button"
          label={nextLabel}
          onPress={leaveShop}
          style={styles.next}
        />
      </View>
      <ConsumableSheet
        run={run}
        instanceId={consumableId}
        onClose={() => setConsumableId(null)}
        onUsed={showNotice}
      />
      <DeckSheet visible={deckOpen} run={run} onClose={() => setDeckOpen(false)} />
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
  rerollRow: { gap: spacing.xs },
  trayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // Reserved so the notice never makes the offers jump.
  noticeSlot: { minHeight: spacing.xl, justifyContent: 'center' },
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
