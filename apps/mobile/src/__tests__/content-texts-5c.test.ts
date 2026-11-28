import { DEFAULT_CONTENT } from '@naipes/engine';
import { EDITION_TEXTS, ENHANCEMENT_TEXTS, JOKER_TEXTS } from '@/i18n/es';

describe('texts for the 5c content', () => {
  it('every joker has a name, a short label and a description', () => {
    for (const joker of DEFAULT_CONTENT.jokers) {
      const text = JOKER_TEXTS[joker.id];
      expect(text?.name).toBeTruthy();
      expect(text?.short).toBeTruthy();
      expect(text?.description).toBeTruthy();
    }
  });

  it('every enhancement has a badge text', () => {
    for (const enhancement of DEFAULT_CONTENT.enhancements) {
      const text = ENHANCEMENT_TEXTS[enhancement.id];
      expect(text?.name).toBeTruthy();
      expect(text?.short).toHaveLength(3);
      expect(text?.description).toBeTruthy();
    }
  });

  it('every edition has a name, a short label of at most 6 characters and a description', () => {
    for (const edition of DEFAULT_CONTENT.editions) {
      const text = EDITION_TEXTS[edition.id];
      expect(text?.name).toBeTruthy();
      expect(text?.short.length).toBeGreaterThan(0);
      expect(text?.short.length).toBeLessThanOrEqual(6);
      expect(text?.description).toBeTruthy();
    }
  });

  it('has no text for content that does not exist', () => {
    expect(Object.keys(EDITION_TEXTS).sort()).toEqual(
      DEFAULT_CONTENT.editions.map((e) => e.id).sort(),
    );
    expect(Object.keys(JOKER_TEXTS).sort()).toEqual(DEFAULT_CONTENT.jokers.map((j) => j.id).sort());
  });
});
