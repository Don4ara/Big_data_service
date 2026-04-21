import {
  createSharedMarketSeasonState,
  isSharedMarketSeasonExpired,
} from './market-season';

describe('market-season', () => {
  it('builds the same season state for the same seed and counter', () => {
    const first = createSharedMarketSeasonState({
      marketProfileSeed: 'market-seed',
      seasonCounter: 3,
      startedAtGlobalBatch: 40,
    });
    const second = createSharedMarketSeasonState({
      marketProfileSeed: 'market-seed',
      seasonCounter: 3,
      startedAtGlobalBatch: 40,
    });

    expect(first).toEqual(second);
  });

  it('changes season parameters when season counter changes', () => {
    const first = createSharedMarketSeasonState({
      marketProfileSeed: 'market-seed',
      seasonCounter: 3,
      startedAtGlobalBatch: 40,
    });
    const second = createSharedMarketSeasonState({
      marketProfileSeed: 'market-seed',
      seasonCounter: 4,
      startedAtGlobalBatch: 40,
    });

    expect(first.seasonKey).not.toBe(second.seasonKey);
    expect(first.marketQualityBias).not.toBe(second.marketQualityBias);
  });

  it('expires only after its full batch window', () => {
    const season = createSharedMarketSeasonState({
      marketProfileSeed: 'market-seed',
      seasonCounter: 1,
      startedAtGlobalBatch: 100,
    });

    expect(isSharedMarketSeasonExpired(season, 100)).toBe(false);
    expect(
      isSharedMarketSeasonExpired(
        season,
        100 + season.seasonLengthBatches - 1,
      ),
    ).toBe(false);
    expect(
      isSharedMarketSeasonExpired(
        season,
        100 + season.seasonLengthBatches,
      ),
    ).toBe(true);
  });
});
