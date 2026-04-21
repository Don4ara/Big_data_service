export type SharedMarketSeasonState = {
  seasonCounter: number;
  seasonKey: string;
  startedAtGlobalBatch: number;
  seasonLengthBatches: number;
  marketQualityBias: number;
  marketLatenessBias: number;
  marketDeliveredRateBias: number;
  marketDeliveringRateBias: number;
};

function hashString(value: string): number {
  let hash = 0;

  for (const char of value) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0);
    hash |= 0;
  }

  return Math.abs(hash);
}

function hashToUnit(value: string): number {
  return (hashString(value) % 10000) / 9999;
}

function hashToRange(value: string, min: number, max: number): number {
  return min + hashToUnit(value) * (max - min);
}

function hashToInt(value: string, min: number, max: number): number {
  return min + Math.floor(hashToUnit(value) * (max - min + 1));
}

export function createSharedMarketSeasonState(input: {
  marketProfileSeed: string;
  seasonCounter: number;
  startedAtGlobalBatch: number;
}): SharedMarketSeasonState {
  const seasonSeed = `${input.marketProfileSeed}|season:${input.seasonCounter}`;

  return {
    seasonCounter: input.seasonCounter,
    seasonKey: `season-${input.seasonCounter}`,
    startedAtGlobalBatch: input.startedAtGlobalBatch,
    seasonLengthBatches: hashToInt(`${seasonSeed}|length`, 6, 12),
    marketQualityBias: hashToRange(`${seasonSeed}|quality`, -0.04, 0.1),
    marketLatenessBias: hashToRange(`${seasonSeed}|lateness`, -0.08, 0.04),
    marketDeliveredRateBias: hashToRange(`${seasonSeed}|delivered`, -0.0055, 0.0055),
    marketDeliveringRateBias: hashToRange(`${seasonSeed}|delivering`, -0.0055, 0.0055),
  };
}

export function isSharedMarketSeasonExpired(
  state: SharedMarketSeasonState,
  globalBatchNumber: number,
): boolean {
  return globalBatchNumber >= state.startedAtGlobalBatch + state.seasonLengthBatches;
}
