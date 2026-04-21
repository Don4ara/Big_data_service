export type RestaurantRuntimeProfile = {
  restaurantId: number;
  seasonKey: string;
  baselineQuality: number;
  baselineLateness: number;
  quality: number;
  lateness: number;
  nextRefreshBatch: number;
};

type RandomFloatFn = (min: number, max: number) => number;
type RandomIntFn = (min: number, max: number) => number;
const RESTAURANT_ERA_SPAN = 4;

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hashString(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash << 5) - hash + char.charCodeAt(0);
    hash |= 0;
  }
  return Math.abs(hash);
}

function hashToUnit(value: string): number {
  return (hashString(value) % 10000) / 9999;
}

function stripSeasonSuffix(value: string): string {
  const seasonSeparatorIndex = value.lastIndexOf('|season-');

  if (seasonSeparatorIndex < 0) {
    return value;
  }

  return value.slice(0, seasonSeparatorIndex);
}

function extractSeasonCounter(value: string): number | null {
  const match = value.match(/\|season-(\d+)$/);

  if (!match) {
    return null;
  }

  return parseInt(match[1], 10);
}

function getRestaurantBaselineSeed(value: string): string {
  return stripSeasonSuffix(value);
}

function getRestaurantEraSeed(value: string): string {
  const stableSeed = stripSeasonSuffix(value);
  const seasonCounter = extractSeasonCounter(value);

  if (seasonCounter === null) {
    return `${stableSeed}|era-0`;
  }

  const eraIndex = Math.floor((seasonCounter - 1) / RESTAURANT_ERA_SPAN) + 1;
  return `${stableSeed}|era-${eraIndex}`;
}

function getRestaurantSeasonShifts(
  seasonKey: string,
  restaurantId: number,
): { qualityMomentum: number; latenessMomentum: number } {
  const eraSeed = getRestaurantEraSeed(seasonKey);
  const eraQualityMomentum =
    (hashToUnit(`${eraSeed}|restaurant:${restaurantId}|era:quality`) - 0.5) * 2;
  const seasonQualityMomentum =
    (hashToUnit(`${seasonKey}|restaurant:${restaurantId}|season:quality`) -
      0.5) *
    2;
  const qualityMomentum = clamp(
    eraQualityMomentum * 0.72 + seasonQualityMomentum * 0.28,
    -1,
    1,
  );
  const eraLatenessMomentum =
    (hashToUnit(`${eraSeed}|restaurant:${restaurantId}|era:lateness`) - 0.5) *
    2;
  const seasonLatenessMomentum =
    (hashToUnit(`${seasonKey}|restaurant:${restaurantId}|season:lateness`) -
      0.5) *
    2;
  const latenessMomentum = clamp(
    eraLatenessMomentum * 0.68 +
      seasonLatenessMomentum * 0.32 -
      qualityMomentum * 0.55,
    -1,
    1,
  );

  return {
    qualityMomentum,
    latenessMomentum,
  };
}

function getQualityBounds(baselineQuality: number): {
  min: number;
  max: number;
  upwardRoom: number;
  downwardRoom: number;
} {
  const eliteHeadroom =
    baselineQuality >= 0.95 ? 0.04 : baselineQuality >= 0.9 ? 0.022 : 0;
  const upwardRoom = lerp(0.055, 0.135, baselineQuality) + eliteHeadroom;
  const downwardRoom = lerp(0.16, 0.1, baselineQuality);
  const min = Math.max(0.18, baselineQuality - downwardRoom);
  const max = Math.min(
    baselineQuality >= 0.95 ? 0.995 : baselineQuality >= 0.9 ? 0.988 : 0.975,
    baselineQuality + upwardRoom,
  );

  return {
    min,
    max,
    upwardRoom: max - baselineQuality,
    downwardRoom: baselineQuality - min,
  };
}

function getLatenessBounds(baselineLateness: number): {
  min: number;
  max: number;
  improvementRoom: number;
  worseningRoom: number;
} {
  const improvementRoom = lerp(0.07, 0.18, baselineLateness);
  const worseningRoom = lerp(0.18, 0.1, baselineLateness);
  const min = Math.max(0.08, baselineLateness - improvementRoom);
  const max = Math.min(0.92, baselineLateness + worseningRoom);

  return {
    min,
    max,
    improvementRoom: baselineLateness - min,
    worseningRoom: max - baselineLateness,
  };
}

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * clampUnit(t);
}

function applyBoundedMomentum(
  baseline: number,
  momentum: number,
  positiveRoom: number,
  negativeRoom: number,
): number {
  if (momentum >= 0) {
    return baseline + positiveRoom * momentum;
  }

  return baseline + negativeRoom * momentum;
}

export function getRestaurantBaselines(
  marketProfileSeed: string,
  restaurantId: number,
): { quality: number; lateness: number } {
  const baselineSeed = getRestaurantBaselineSeed(marketProfileSeed);
  const qualitySeed = hashToUnit(
    `${baselineSeed}|restaurant:${restaurantId}|quality`,
  );
  const qualityJitter =
    (hashToUnit(`${baselineSeed}|restaurant:${restaurantId}|quality:jitter`) -
      0.5) *
    0.12;

  let baseQuality = 0.6;
  if (qualitySeed < 0.05) baseQuality = 0.24;
  else if (qualitySeed < 0.14) baseQuality = 0.34;
  else if (qualitySeed < 0.28) baseQuality = 0.46;
  else if (qualitySeed < 0.48) baseQuality = 0.58;
  else if (qualitySeed < 0.7) baseQuality = 0.68;
  else if (qualitySeed < 0.86) baseQuality = 0.78;
  else if (qualitySeed < 0.94) baseQuality = 0.88;
  else if (qualitySeed < 0.985) baseQuality = 0.945;
  else baseQuality = 0.982;

  const baselineQuality = clampUnit(baseQuality + qualityJitter);
  const latenessNoise =
    (hashToUnit(`${baselineSeed}|restaurant:${restaurantId}|lateness`) - 0.5) *
    0.2;
  const baselineLateness = clampUnit(
    0.63 - baselineQuality * 0.5 + latenessNoise,
  );

  return {
    quality: baselineQuality,
    lateness: baselineLateness,
  };
}

export function createRestaurantRuntimeProfile(input: {
  seasonKey: string;
  restaurantId: number;
  marketQualityBias: number;
  marketLatenessBias: number;
  scheduleAnchorBatch: number;
  randomFloat: RandomFloatFn;
  randomInt: RandomIntFn;
}): RestaurantRuntimeProfile {
  const baselines = getRestaurantBaselines(input.seasonKey, input.restaurantId);
  const seasonShifts = getRestaurantSeasonShifts(
    input.seasonKey,
    input.restaurantId,
  );
  const qualityBounds = getQualityBounds(baselines.quality);
  const latenessBounds = getLatenessBounds(baselines.lateness);
  const targetQuality = clamp(
    applyBoundedMomentum(
      baselines.quality,
      seasonShifts.qualityMomentum,
      qualityBounds.upwardRoom,
      qualityBounds.downwardRoom,
    ) +
      input.marketQualityBias * 0.05 +
      input.randomFloat(-0.02, 0.02),
    qualityBounds.min,
    qualityBounds.max,
  );
  const targetLateness = clamp(
    applyBoundedMomentum(
      baselines.lateness,
      seasonShifts.latenessMomentum,
      latenessBounds.worseningRoom,
      latenessBounds.improvementRoom,
    ) +
      input.marketLatenessBias * 0.06 +
      input.randomFloat(-0.03, 0.03),
    latenessBounds.min,
    latenessBounds.max,
  );

  return {
    restaurantId: input.restaurantId,
    seasonKey: input.seasonKey,
    baselineQuality: baselines.quality,
    baselineLateness: baselines.lateness,
    quality: clampUnit(targetQuality),
    lateness: clampUnit(targetLateness),
    nextRefreshBatch: input.scheduleAnchorBatch + input.randomInt(4, 9),
  };
}

export function refreshRestaurantRuntimeProfile(input: {
  profile: RestaurantRuntimeProfile;
  marketQualityBias: number;
  marketLatenessBias: number;
  scheduleAnchorBatch: number;
  randomFloat: RandomFloatFn;
  randomInt: RandomIntFn;
}): RestaurantRuntimeProfile {
  const seasonShifts = getRestaurantSeasonShifts(
    input.profile.seasonKey,
    input.profile.restaurantId,
  );
  const qualityBounds = getQualityBounds(input.profile.baselineQuality);
  const latenessBounds = getLatenessBounds(input.profile.baselineLateness);
  const marketQualityTarget = clamp(
    applyBoundedMomentum(
      input.profile.baselineQuality,
      seasonShifts.qualityMomentum,
      qualityBounds.upwardRoom,
      qualityBounds.downwardRoom,
    ) +
      input.marketQualityBias * 0.06 +
      input.randomFloat(-0.025, 0.025),
    qualityBounds.min,
    qualityBounds.max,
  );
  const marketLatenessTarget = clamp(
    applyBoundedMomentum(
      input.profile.baselineLateness,
      seasonShifts.latenessMomentum,
      latenessBounds.worseningRoom,
      latenessBounds.improvementRoom,
    ) +
      input.marketLatenessBias * 0.08 +
      (0.52 - marketQualityTarget) * 0.05 +
      input.randomFloat(-0.035, 0.035),
    latenessBounds.min,
    latenessBounds.max,
  );

  return {
    ...input.profile,
    quality: clampUnit(
      input.profile.quality * 0.86 + marketQualityTarget * 0.14,
    ),
    lateness: clampUnit(
      input.profile.lateness * 0.84 + marketLatenessTarget * 0.16,
    ),
    nextRefreshBatch: input.scheduleAnchorBatch + input.randomInt(4, 9),
  };
}
