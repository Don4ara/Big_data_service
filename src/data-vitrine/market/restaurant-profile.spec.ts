import {
  createRestaurantRuntimeProfile,
  getRestaurantBaselines,
  refreshRestaurantRuntimeProfile,
} from './restaurant-profile';
import { restaurants } from '../generation/mock-dictionaries';

describe('restaurant-profile', () => {
  function getAverage(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function getMedian(values: number[]): number {
    const sorted = [...values].sort((left, right) => left - right);
    const middleIndex = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 0
      ? (sorted[middleIndex - 1] + sorted[middleIndex]) / 2
      : sorted[middleIndex];
  }

  function buildProfiles(seasonKey: string) {
    return restaurants.map((restaurant) => {
      const profile = createRestaurantRuntimeProfile({
        seasonKey,
        restaurantId: restaurant.id,
        marketQualityBias: 0,
        marketLatenessBias: 0,
        scheduleAnchorBatch: 1,
        randomFloat: (min, max) => (min + max) / 2,
        randomInt: (min) => min,
      });

      return {
        id: restaurant.id,
        brandName: restaurant.brandName,
        baselineQuality: profile.baselineQuality,
        baselineLateness: profile.baselineLateness,
        quality: profile.quality,
        lateness: profile.lateness,
      };
    });
  }

  function buildTopRestaurants(seasonKey: string, limit = 10) {
    return buildProfiles(seasonKey)
      .sort((left, right) => right.quality - left.quality)
      .slice(0, limit)
      .map((restaurant, index) => ({
        rank: index + 1,
        id: restaurant.id,
        brandName: restaurant.brandName,
        quality: restaurant.quality.toFixed(3),
      }));
  }

  it('produces deterministic baselines for the same seed and restaurant', () => {
    const first = getRestaurantBaselines('seed-1', 12);
    const second = getRestaurantBaselines('seed-1', 12);
    const third = getRestaurantBaselines('seed-2', 12);

    expect(first).toEqual(second);
    expect(third).not.toEqual(first);
  });

  it('creates runtime profile within valid bounds', () => {
    const profile = createRestaurantRuntimeProfile({
      seasonKey: 'seed-1|season-1',
      restaurantId: 12,
      marketQualityBias: 0.05,
      marketLatenessBias: -0.03,
      scheduleAnchorBatch: 10,
      randomFloat: (min, max) => (min + max) / 2,
      randomInt: (min) => min,
    });

    expect(profile.quality).toBeGreaterThanOrEqual(0);
    expect(profile.quality).toBeLessThanOrEqual(1);
    expect(profile.lateness).toBeGreaterThanOrEqual(0);
    expect(profile.lateness).toBeLessThanOrEqual(1);
    expect(profile.nextRefreshBatch).toBeGreaterThan(10);
  });

  it('refreshes runtime profile while preserving baselines', () => {
    const initialProfile = createRestaurantRuntimeProfile({
      seasonKey: 'seed-1|season-1',
      restaurantId: 12,
      marketQualityBias: 0,
      marketLatenessBias: 0,
      scheduleAnchorBatch: 10,
      randomFloat: (min, max) => (min + max) / 2,
      randomInt: (min) => min,
    });

    const refreshedProfile = refreshRestaurantRuntimeProfile({
      profile: initialProfile,
      marketQualityBias: 0.04,
      marketLatenessBias: -0.06,
      scheduleAnchorBatch: 15,
      randomFloat: (min, max) => (min + max) / 2,
      randomInt: (min) => min,
    });

    expect(refreshedProfile.baselineQuality).toBe(
      initialProfile.baselineQuality,
    );
    expect(refreshedProfile.baselineLateness).toBe(
      initialProfile.baselineLateness,
    );
    expect(refreshedProfile.nextRefreshBatch).toBeGreaterThan(15);
  });

  it('keeps stable baselines within the same era while seasonal runtime shifts', () => {
    const firstSeason = createRestaurantRuntimeProfile({
      seasonKey: 'seed-1|season-1',
      restaurantId: 12,
      marketQualityBias: 0,
      marketLatenessBias: 0,
      scheduleAnchorBatch: 10,
      randomFloat: (min, max) => (min + max) / 2,
      randomInt: (min) => min,
    });

    const secondSeason = createRestaurantRuntimeProfile({
      seasonKey: 'seed-1|season-2',
      restaurantId: 12,
      marketQualityBias: 0,
      marketLatenessBias: 0,
      scheduleAnchorBatch: 10,
      randomFloat: (min, max) => (min + max) / 2,
      randomInt: (min) => min,
    });

    expect(secondSeason.seasonKey).not.toBe(firstSeason.seasonKey);
    expect(secondSeason.baselineQuality).toBe(firstSeason.baselineQuality);
    expect(secondSeason.baselineLateness).toBe(firstSeason.baselineLateness);
    expect(secondSeason.quality).not.toBe(firstSeason.quality);
  });

  it('keeps baselines stable and only shifts runtime form when a new era starts', () => {
    const firstEra = createRestaurantRuntimeProfile({
      seasonKey: 'seed-1|season-1',
      restaurantId: 12,
      marketQualityBias: 0,
      marketLatenessBias: 0,
      scheduleAnchorBatch: 10,
      randomFloat: (min, max) => (min + max) / 2,
      randomInt: (min) => min,
    });

    const nextEra = createRestaurantRuntimeProfile({
      seasonKey: 'seed-1|season-5',
      restaurantId: 12,
      marketQualityBias: 0,
      marketLatenessBias: 0,
      scheduleAnchorBatch: 10,
      randomFloat: (min, max) => (min + max) / 2,
      randomInt: (min) => min,
    });

    expect(nextEra.baselineQuality).toBe(firstEra.baselineQuality);
    expect(nextEra.baselineLateness).toBe(firstEra.baselineLateness);
    expect(Math.abs(nextEra.quality - firstEra.quality)).toBeGreaterThan(0.01);
    expect(Math.abs(nextEra.quality - firstEra.quality)).toBeLessThan(0.13);
  });

  it('keeps market-wide quality and lateness in a sane range', () => {
    const profiles = restaurants.map((restaurant) =>
      createRestaurantRuntimeProfile({
        seasonKey: 'seed-1|season-1',
        restaurantId: restaurant.id,
        marketQualityBias: 0,
        marketLatenessBias: 0,
        scheduleAnchorBatch: 10,
        randomFloat: (min, max) => (min + max) / 2,
        randomInt: (min) => min,
      }),
    );

    const averageQuality =
      profiles.reduce((sum, profile) => sum + profile.quality, 0) /
      profiles.length;
    const averageLateness =
      profiles.reduce((sum, profile) => sum + profile.lateness, 0) /
      profiles.length;
    const worstQuality = Math.min(
      ...profiles.map((profile) => profile.quality),
    );
    const worstLateness = Math.max(
      ...profiles.map((profile) => profile.lateness),
    );

    expect(averageQuality).toBeGreaterThan(0.45);
    expect(averageLateness).toBeLessThan(0.55);
    expect(worstQuality).toBeGreaterThan(0.1);
    expect(worstLateness).toBeLessThan(0.8);
  });

  it('keeps the same restaurant profile for workers joining the same season later', () => {
    const buildProfileAtBatch = (currentBatch: number) => {
      let profile = createRestaurantRuntimeProfile({
        seasonKey: 'seed-1|season-1',
        restaurantId: 12,
        marketQualityBias: 0.03,
        marketLatenessBias: -0.02,
        scheduleAnchorBatch: 100,
        randomFloat: (min, max) => (min + max) / 2,
        randomInt: (min) => min,
      });

      while (currentBatch >= profile.nextRefreshBatch) {
        const refreshAnchorBatch = profile.nextRefreshBatch;
        profile = refreshRestaurantRuntimeProfile({
          profile,
          marketQualityBias: 0.03,
          marketLatenessBias: -0.02,
          scheduleAnchorBatch: refreshAnchorBatch,
          randomFloat: (min, max) => (min + max) / 2,
          randomInt: (min) => min,
        });
      }

      return profile;
    };

    const workerOneProfile = buildProfileAtBatch(108);
    const workerTwoProfile = buildProfileAtBatch(108);

    expect(workerTwoProfile).toEqual(workerOneProfile);
  });

  it('allows the leaderboard to change when eras rotate', () => {
    const firstEraTop = buildTopRestaurants('seed-1|season-1', 10).map(
      (restaurant) => restaurant.id,
    );
    const nextEraTop = buildTopRestaurants('seed-1|season-5', 10).map(
      (restaurant) => restaurant.id,
    );
    const overlap = firstEraTop.filter((restaurantId) =>
      nextEraTop.includes(restaurantId),
    );

    expect(nextEraTop).not.toEqual(firstEraTop);
    expect(overlap.length).toBeGreaterThanOrEqual(5);
    expect(overlap.length).toBeLessThan(10);
  });

  it('keeps the long-term elite ahead of the long-term outsiders across eras', () => {
    const baselineRanking = restaurants
      .map((restaurant) => ({
        id: restaurant.id,
        baselineQuality: getRestaurantBaselines('seed-1', restaurant.id)
          .quality,
      }))
      .sort((left, right) => right.baselineQuality - left.baselineQuality);
    const eliteIds = new Set(
      baselineRanking.slice(0, 10).map((restaurant) => restaurant.id),
    );
    const outsiderIds = new Set(
      baselineRanking.slice(-10).map((restaurant) => restaurant.id),
    );
    const nextEraProfiles = buildProfiles('seed-1|season-5');
    const eliteAverage =
      nextEraProfiles
        .filter((profile) => eliteIds.has(profile.id))
        .reduce((sum, profile) => sum + profile.quality, 0) / eliteIds.size;
    const outsiderAverage =
      nextEraProfiles
        .filter((profile) => outsiderIds.has(profile.id))
        .reduce((sum, profile) => sum + profile.quality, 0) / outsiderIds.size;

    expect(eliteAverage - outsiderAverage).toBeGreaterThan(0.12);
  });

  it('creates a small elite tier with near-perfect runtime quality', () => {
    const seasonProfiles = buildProfiles('seed-1|season-1').sort(
      (left, right) => right.quality - left.quality,
    );
    const topProfiles = seasonProfiles.slice(0, 5);

    expect(topProfiles[0].quality).toBeGreaterThanOrEqual(0.98);
    expect(topProfiles[0].lateness).toBeLessThanOrEqual(0.22);
    expect(
      topProfiles.filter((profile) => profile.quality >= 0.96).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('prints top restaurants for different eras', () => {
    const seasonOneTop = buildTopRestaurants('seed-1|season-1');
    const seasonTwoTop = buildTopRestaurants('seed-1|season-5');
    const seasonOneProfiles = buildProfiles('seed-1|season-1');
    const seasonTwoProfiles = buildProfiles('seed-1|season-5');

    console.log('\nRestaurant market summary');
    console.table([
      {
        season: 'season-1',
        avgQuality: getAverage(
          seasonOneProfiles.map((profile) => profile.quality),
        ).toFixed(3),
        medianQuality: getMedian(
          seasonOneProfiles.map((profile) => profile.quality),
        ).toFixed(3),
        avgLateness: getAverage(
          seasonOneProfiles.map((profile) => profile.lateness),
        ).toFixed(3),
      },
      {
        season: 'season-5',
        avgQuality: getAverage(
          seasonTwoProfiles.map((profile) => profile.quality),
        ).toFixed(3),
        medianQuality: getMedian(
          seasonTwoProfiles.map((profile) => profile.quality),
        ).toFixed(3),
        avgLateness: getAverage(
          seasonTwoProfiles.map((profile) => profile.lateness),
        ).toFixed(3),
      },
    ]);

    console.log('\nTop restaurants for seed-1|season-1');
    console.table(seasonOneTop);
    console.log('Top restaurants for seed-1|season-5');
    console.table(seasonTwoTop);

    expect(seasonOneTop).toHaveLength(10);
    expect(seasonTwoTop).toHaveLength(10);
  });
});
