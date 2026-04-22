import { buildRandomOrderDate2026, formatSpoiledDateValue } from './order-date';

describe('order-date', () => {
  it('starts at the first millisecond of 2026', () => {
    expect(buildRandomOrderDate2026(() => 0).toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('ends at the last millisecond of December 29, 2026', () => {
    expect(buildRandomOrderDate2026(() => 1).toISOString()).toBe(
      '2026-12-29T23:59:59.999Z',
    );
  });

  it('keeps generated dates inside 2026', () => {
    const samples = [0.1, 0.25, 0.5, 0.75, 0.999999];

    for (const sample of samples) {
      const date = buildRandomOrderDate2026(() => sample);

      expect(date.getUTCFullYear()).toBe(2026);
    }
  });

  it('spoils dates into ISO, unix seconds, calendar dates, or calendar dates with minutes', () => {
    const date = new Date('2026-12-29T13:45:59.999Z');

    expect(formatSpoiledDateValue(date, () => 0.1)).toBe(
      '2026-12-29T13:45:59.999Z',
    );
    expect(formatSpoiledDateValue(date, () => 0.3)).toBe(1798551959);
    expect(formatSpoiledDateValue(date, () => 0.6)).toBe('29.12.2026');
    expect(formatSpoiledDateValue(date, () => 0.9)).toBe('29.12.2026 13:45');
  });
});
