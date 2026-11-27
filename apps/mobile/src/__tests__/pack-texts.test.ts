import { DEFAULT_CONTENT } from '@naipes/engine';
import { es, PACK_TEXTS, VOUCHER_TEXTS } from '@/i18n/es';

describe('pack and voucher texts', () => {
  it('every pack has a name and a description', () => {
    for (const pack of DEFAULT_CONTENT.packs) {
      expect(PACK_TEXTS[pack.id]?.name).toBeTruthy();
      expect(PACK_TEXTS[pack.id]?.description).toBeTruthy();
    }
  });

  it('every voucher has a name, a short effect and a description', () => {
    for (const voucher of DEFAULT_CONTENT.vouchers) {
      const text = VOUCHER_TEXTS[voucher.id];
      expect(text?.name).toBeTruthy();
      expect(text?.short).toBeTruthy();
      expect(text?.description).toBeTruthy();
    }
  });

  it('has no text for content that does not exist', () => {
    expect(Object.keys(PACK_TEXTS).sort()).toEqual(DEFAULT_CONTENT.packs.map((p) => p.id).sort());
    expect(Object.keys(VOUCHER_TEXTS).sort()).toEqual(
      DEFAULT_CONTENT.vouchers.map((v) => v.id).sort(),
    );
  });

  it('formats the pick counters', () => {
    expect(es.packs.pick(1, 1)).toBe('Elige 1');
    expect(es.packs.pick(2, 1)).toBe('Elige 2 (quedan 1)');
    expect(es.shop.packPick(3, 1)).toBe('Elige 1 de 3');
    expect(es.packs.cardItem('Rey', 'corazones')).toBe('Rey de corazones');
  });
});
