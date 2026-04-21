export type ReviewRatingInput = {
  quality: number;
  delayHours: number;
  itemsCount: number;
  requiresContactlessDelivery: boolean;
  isEcoFriendlyPackaging: boolean;
  randomChoice: <T>(choices: T[]) => T;
  randomFloat: () => number;
};

function clampRating(value: number): number {
  return Math.max(0.5, Math.min(5.0, value));
}

function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function getDelayHoursChoices(lateness: number): number[] {
  const normalizedLateness = clampUnit(lateness);

  if (normalizedLateness >= 0.9) return [0, 1, 2, 3, 4, 5, 5];
  if (normalizedLateness >= 0.75) return [0, 1, 1, 2, 2, 3, 4, 5];
  if (normalizedLateness >= 0.55) return [0, 0, 1, 1, 2, 2, 3, 4];
  if (normalizedLateness >= 0.35) return [0, 0, 0, 0, 1, 1, 2, 3];
  if (normalizedLateness >= 0.15) return [0, 0, 0, 0, 0, 1, 1, 2];
  return [0, 0, 0, 0, 0, 0, 1, 1];
}

export function getZeroDelayMinuteChoices(lateness: number): number[] {
  const normalizedLateness = clampUnit(lateness);

  if (normalizedLateness >= 0.85) return [10, 15, 20, 25, 30, 35, 40, 45];
  if (normalizedLateness >= 0.65) return [5, 10, 15, 20, 25, 30, 35, 40];
  if (normalizedLateness >= 0.45) return [0, 5, 10, 15, 20, 20, 25, 30];
  if (normalizedLateness >= 0.2) return [0, 0, 5, 5, 10, 10, 15, 20];
  return [0, 0, 0, 5, 5, 10, 10, 15];
}

export function getReviewDelayPenalty(delayHours: number): number {
  if (delayHours >= 7.5) return 2.5;
  if (delayHours >= 7.0) return 2.25;
  if (delayHours >= 6.0) return 2.0;
  if (delayHours >= 5.5) return 1.75;
  if (delayHours >= 4.5) return 1.5;
  if (delayHours >= 4.0) return 1.25;
  if (delayHours >= 3.0) return 1.0;
  if (delayHours >= 2.5) return 0.75;
  if (delayHours >= 1.5) return 0.5;
  if (delayHours >= 1.0) return 0.25;
  return 0;
}

function getQualityScenarioBand(quality: number): number {
  if (quality >= 0.9) return 4;
  if (quality >= 0.72) return 3;
  if (quality >= 0.45) return 2;
  if (quality >= 0.18) return 1;
  return 0;
}

function getBaseScore(
  quality: number,
  randomChoice: <T>(choices: T[]) => T,
): number {
  if (quality >= 0.975) {
    return 4.82 + randomChoice([0.03, 0.08, 0.12, 0.16]);
  }

  if (quality >= 0.95) {
    return 4.68 + randomChoice([0, 0.05, 0.1, 0.14, 0.18]);
  }

  const curvedQuality = Math.pow(clampUnit(quality), 0.82);
  const baseline = lerp(1.35, 4.45, curvedQuality);
  const spread =
    quality >= 0.9
      ? 0.15
      : quality >= 0.72
        ? 0.25
        : quality >= 0.45
          ? 0.35
          : 0.45;

  return baseline + randomChoice([-spread, -spread / 2, 0, spread / 2, spread]);
}

function getRestaurantFactor(
  quality: number,
  randomChoice: <T>(choices: T[]) => T,
): number {
  switch (getQualityScenarioBand(quality)) {
    case 4:
      return lerp(0.05, 0.14, quality) + randomChoice([0, 0.1, 0.15, 0.2]);
    case 3:
      return lerp(0, 0.15, quality) + randomChoice([-0.1, 0.05, 0.1, 0.2]);
    case 2:
      return (
        lerp(-0.08, 0.08, quality) + randomChoice([-0.15, -0.05, 0.05, 0.15])
      );
    case 1:
      return lerp(-0.2, -0.02, quality) + randomChoice([-0.25, -0.1, 0, 0.05]);
    default:
      return lerp(-0.3, -0.12, quality) + randomChoice([-0.3, -0.15, -0.05]);
  }
}

function getCourierFactor(
  quality: number,
  randomChoice: <T>(choices: T[]) => T,
): number {
  switch (getQualityScenarioBand(quality)) {
    case 4:
      return lerp(0.02, 0.1, quality) + randomChoice([0, 0.05, 0.1, 0.15]);
    case 3:
      return lerp(-0.02, 0.1, quality) + randomChoice([-0.1, 0, 0.05, 0.15]);
    case 2:
      return (
        lerp(-0.1, 0, quality) + randomChoice([-0.15, -0.05, 0, 0.05, 0.1])
      );
    case 1:
      return (
        lerp(-0.18, -0.03, quality) +
        randomChoice([-0.25, -0.15, -0.05, 0, 0.05])
      );
    default:
      return (
        lerp(-0.28, -0.1, quality) + randomChoice([-0.3, -0.2, -0.1, -0.05])
      );
  }
}

function getComplexityFactor(
  input: Pick<
    ReviewRatingInput,
    'itemsCount' | 'requiresContactlessDelivery' | 'isEcoFriendlyPackaging'
  >,
  quality: number,
  randomChoice: <T>(choices: T[]) => T,
): number {
  const isComplex =
    input.itemsCount >= 5 ||
    input.requiresContactlessDelivery ||
    input.isEcoFriendlyPackaging;

  if (!isComplex) {
    if (quality >= 0.95) {
      return lerp(0.08, 0.16, quality) + randomChoice([0.05, 0.1, 0.15, 0.2]);
    }

    switch (getQualityScenarioBand(quality)) {
      case 4:
        return lerp(0.02, 0.08, quality) + randomChoice([0, 0.05, 0.1, 0.15]);
      case 3:
        return lerp(0, 0.08, quality) + randomChoice([-0.05, 0.05, 0.1, 0.15]);
      case 2:
        return lerp(-0.06, 0.02, quality) + randomChoice([-0.1, 0, 0.05, 0.1]);
      case 1:
        return (
          lerp(-0.14, -0.02, quality) + randomChoice([-0.15, -0.05, 0, 0.05])
        );
      default:
        return (
          lerp(-0.22, -0.08, quality) + randomChoice([-0.2, -0.1, -0.05, 0])
        );
    }
  }

  if (quality >= 0.97) {
    return lerp(-0.02, 0.06, quality) + randomChoice([0, 0.05, 0.1, 0.15]);
  }

  if (quality >= 0.94) {
    return lerp(-0.06, 0.02, quality) + randomChoice([-0.05, 0, 0.05, 0.1]);
  }

  switch (getQualityScenarioBand(quality)) {
    case 4:
      return lerp(-0.1, -0.02, quality) + randomChoice([-0.2, -0.1, 0, 0.05]);
    case 3:
      return lerp(-0.12, -0.04, quality) + randomChoice([-0.25, -0.1, 0, 0.05]);
    case 2:
      return (
        lerp(-0.2, -0.08, quality) + randomChoice([-0.35, -0.2, -0.1, 0, 0.05])
      );
    case 1:
      return (
        lerp(-0.3, -0.12, quality) + randomChoice([-0.45, -0.3, -0.15, -0.05])
      );
    default:
      return (
        lerp(-0.45, -0.18, quality) + randomChoice([-0.55, -0.4, -0.25, -0.1])
      );
  }
}

function getRandomNoise(
  quality: number,
  randomChoice: <T>(choices: T[]) => T,
): number {
  if (quality >= 0.975) {
    return randomChoice([0.05, 0.1, 0.15, 0.2]);
  }

  if (quality >= 0.95) {
    return randomChoice([0, 0.05, 0.1, 0.15, 0.2]);
  }

  switch (getQualityScenarioBand(quality)) {
    case 4:
      return randomChoice([-0.05, 0, 0.05, 0.1, 0.15]);
    case 3:
      return randomChoice([-0.05, 0, 0.05, 0.1, 0.2]);
    case 2:
      return randomChoice([-0.1, -0.05, 0.05, 0.1, 0.15]);
    case 1:
      return randomChoice([-0.15, -0.1, 0, 0.05, 0.1]);
    default:
      return randomChoice([-0.2, -0.1, -0.05, 0, 0.05]);
  }
}

function getExcellenceBonus(
  input: Pick<
    ReviewRatingInput,
    | 'delayHours'
    | 'itemsCount'
    | 'requiresContactlessDelivery'
    | 'isEcoFriendlyPackaging'
    | 'randomFloat'
    | 'randomChoice'
  >,
  quality: number,
): number {
  const simpleOrder =
    input.itemsCount <= 3 &&
    !input.requiresContactlessDelivery &&
    !input.isEcoFriendlyPackaging;
  const excellenceChance =
    quality >= 0.96 ? 0.3 : quality >= 0.9 ? 0.22 : quality >= 0.8 ? 0.1 : 0.02;

  if (
    input.delayHours < 1 &&
    simpleOrder &&
    input.randomFloat() < excellenceChance
  ) {
    return input.randomChoice([0.25, 0.35, 0.5]);
  }
  return 0;
}

function getPerfectDeliveryBonus(
  input: Pick<
    ReviewRatingInput,
    | 'delayHours'
    | 'itemsCount'
    | 'requiresContactlessDelivery'
    | 'isEcoFriendlyPackaging'
    | 'randomFloat'
    | 'randomChoice'
  >,
  quality: number,
): number {
  const simpleOrder =
    input.itemsCount <= 3 &&
    !input.requiresContactlessDelivery &&
    !input.isEcoFriendlyPackaging;

  if (!simpleOrder || input.delayHours >= 0.45 || quality < 0.92) {
    return 0;
  }

  const perfectRunChance =
    quality >= 0.985 ? 0.45 : quality >= 0.96 ? 0.34 : 0.22;

  if (input.randomFloat() < perfectRunChance) {
    return input.randomChoice([0.25, 0.35, 0.5, 0.65]);
  }

  return 0;
}

function getPremiumConsistencyBonus(
  input: Pick<
    ReviewRatingInput,
    | 'delayHours'
    | 'itemsCount'
    | 'requiresContactlessDelivery'
    | 'isEcoFriendlyPackaging'
    | 'randomChoice'
  >,
  quality: number,
): number {
  if (quality < 0.9 || input.delayHours >= 1.1) {
    return 0;
  }

  const premiumStrength = clampUnit((quality - 0.9) / 0.1);
  const complexityWeight =
    input.itemsCount <= 3 &&
    !input.requiresContactlessDelivery &&
    !input.isEcoFriendlyPackaging
      ? 1
      : input.itemsCount <= 4 && !input.requiresContactlessDelivery
        ? 0.76
        : 0.48;
  const timingWeight =
    input.delayHours < 0.25
      ? 1
      : input.delayHours < 0.5
        ? 0.82
        : input.delayHours < 0.8
          ? 0.58
          : 0.34;
  const baseBonus =
    lerp(0.05, 0.32, premiumStrength) * complexityWeight * timingWeight;

  if (baseBonus <= 0.02) {
    return 0;
  }

  return input.randomChoice([baseBonus * 0.75, baseBonus, baseBonus + 0.08]);
}

function getLegendaryServiceBonus(
  input: Pick<
    ReviewRatingInput,
    | 'delayHours'
    | 'itemsCount'
    | 'requiresContactlessDelivery'
    | 'isEcoFriendlyPackaging'
    | 'randomChoice'
  >,
  quality: number,
): number {
  if (quality < 0.955 || input.delayHours >= 0.75) {
    return 0;
  }

  const isSimpleOrder =
    input.itemsCount <= 3 &&
    !input.requiresContactlessDelivery &&
    !input.isEcoFriendlyPackaging;
  const isManageableOrder =
    input.itemsCount <= 5 && !input.requiresContactlessDelivery;
  const strength = clampUnit((quality - 0.955) / 0.045);
  const timingWeight =
    input.delayHours < 0.2
      ? 1
      : input.delayHours < 0.4
        ? 0.88
        : input.delayHours < 0.6
          ? 0.72
          : 0.5;
  const orderWeight = isSimpleOrder ? 1 : isManageableOrder ? 0.8 : 0.58;
  const baseBonus = lerp(0.14, 0.38, strength) * timingWeight * orderWeight;

  if (baseBonus <= 0.08) {
    return 0;
  }

  return input.randomChoice([baseBonus, baseBonus + 0.06, baseBonus + 0.12]);
}

function getIncidentPenalty(
  input: Pick<ReviewRatingInput, 'delayHours' | 'randomFloat' | 'randomChoice'>,
  quality: number,
): number {
  const incidentChance =
    quality >= 0.9
      ? 0.02
      : quality >= 0.72
        ? 0.05
        : quality >= 0.45
          ? 0.1
          : quality >= 0.18
            ? 0.16
            : 0.24;

  if (input.delayHours < 3 && input.randomFloat() < incidentChance) {
    return input.randomChoice([0.25, 0.5, 0.75, 1.0]);
  }
  return 0;
}

export function buildReviewRating(input: ReviewRatingInput): {
  rating: number;
} {
  const quality = clampUnit(input.quality);
  const qualityLift = lerp(0, 0.3, quality);
  const baseScore = getBaseScore(quality, input.randomChoice);
  const restaurantFactor = getRestaurantFactor(quality, input.randomChoice);
  const courierFactor = getCourierFactor(quality, input.randomChoice);
  const complexityFactor = getComplexityFactor(
    input,
    quality,
    input.randomChoice,
  );
  const randomNoise = getRandomNoise(quality, input.randomChoice);
  const excellenceBonus = getExcellenceBonus(input, quality);
  const perfectDeliveryBonus = getPerfectDeliveryBonus(input, quality);
  const premiumConsistencyBonus = getPremiumConsistencyBonus(input, quality);
  const legendaryServiceBonus = getLegendaryServiceBonus(input, quality);
  const incidentPenalty = getIncidentPenalty(input, quality);
  const delayPenalty = getReviewDelayPenalty(input.delayHours);

  return {
    rating: roundToHalf(
      clampRating(
        baseScore +
          qualityLift +
          restaurantFactor +
          courierFactor +
          complexityFactor +
          randomNoise +
          excellenceBonus +
          perfectDeliveryBonus +
          premiumConsistencyBonus +
          legendaryServiceBonus -
          delayPenalty -
          incidentPenalty,
      ),
    ),
  };
}
