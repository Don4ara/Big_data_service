export type ReviewRatingInput = {
  restaurantKey: string;
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

function hashString(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0);
    hash |= 0;
  }
  return Math.abs(hash);
}

function roundToQuarter(value: number): number {
  return Math.round(value * 4) / 4;
}

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

export function getRestaurantQuality(restaurantKey: string): number {
  return (hashString(restaurantKey) % 1000) / 999;
}

export function getRestaurantLateness(restaurantKey: string): number {
  return (Math.floor(hashString(`${restaurantKey}:late`) / 7) % 1000) / 999;
}

function getRestaurantScenarioDrift(restaurantKey: string): number {
  return (Math.floor(hashString(`${restaurantKey}:drift`) / 11) % 1000) / 999;
}

function getEffectiveRestaurantQuality(restaurantKey: string): number {
  const baseQuality = getRestaurantQuality(restaurantKey);
  const drift = getRestaurantScenarioDrift(restaurantKey);
  const quality = baseQuality + (drift - 0.5) * 0.9;
  return Math.max(0, Math.min(1, quality));
}

function getEffectiveRestaurantLateness(restaurantKey: string): number {
  const baseLateness = getRestaurantLateness(restaurantKey);
  const drift = getRestaurantScenarioDrift(`${restaurantKey}:late-drift`);
  const lateness = baseLateness + (drift - 0.5) * 0.8;
  return Math.max(0, Math.min(1, lateness));
}

export function buildRestaurantScenarioKey(restaurantKey: string, batchSeed: string): string {
  return `${restaurantKey}|${batchSeed}`;
}

export function getRestaurantDelayHoursChoices(restaurantKey: string): number[] {
  const lateness = getEffectiveRestaurantLateness(restaurantKey);

  if (lateness >= 0.9) return [0, 1, 2, 3, 4, 5, 5];
  if (lateness >= 0.75) return [0, 1, 1, 2, 2, 3, 4, 5];
  if (lateness >= 0.55) return [0, 0, 1, 1, 2, 2, 3, 4];
  if (lateness >= 0.35) return [0, 0, 0, 1, 1, 2, 2, 3];
  if (lateness >= 0.15) return [0, 0, 0, 0, 1, 1, 2, 3];
  return [0, 0, 0, 0, 0, 1, 1, 2];
}

export function getRestaurantZeroDelayMinuteChoices(restaurantKey: string): number[] {
  const lateness = getEffectiveRestaurantLateness(restaurantKey);

  if (lateness >= 0.85) return [10, 15, 20, 25, 30, 35, 40, 45];
  if (lateness >= 0.65) return [5, 10, 15, 20, 25, 30, 35, 40];
  if (lateness >= 0.45) return [0, 5, 10, 15, 20, 25, 30, 35];
  if (lateness >= 0.2) return [0, 5, 10, 15, 20, 25, 30];
  return [0, 0, 5, 5, 10, 10, 15, 20];
}

export function getReviewDelayPenalty(delayHours: number): number {
  if (delayHours >= 7.5) return 5.0;
  if (delayHours >= 7.0) return 4.5;
  if (delayHours >= 6.0) return 4.0;
  if (delayHours >= 5.5) return 3.5;
  if (delayHours >= 4.5) return 3.0;
  if (delayHours >= 4.0) return 2.5;
  if (delayHours >= 3.0) return 2.0;
  if (delayHours >= 2.5) return 1.5;
  if (delayHours >= 1.5) return 1.0;
  if (delayHours >= 1.0) return 0.5;
  return 0;
}

function getQualityScenarioBand(quality: number): number {
  if (quality >= 0.85) return 4;
  if (quality >= 0.65) return 3;
  if (quality >= 0.4) return 2;
  if (quality >= 0.2) return 1;
  return 0;
}

function getBaseScore(quality: number, randomChoice: <T>(choices: T[]) => T): number {
  const base = randomChoice([4.0, 4.25, 4.5, 4.75, 5.0]);
  const qualityShift = roundToQuarter(lerp(-1.0, 0.75, quality));
  return base + qualityShift;
}

function getRestaurantFactor(quality: number, randomChoice: <T>(choices: T[]) => T): number {
  const center = roundToQuarter(lerp(-0.5, 0.5, quality));
  return center + randomChoice([-0.25, 0, 0.25]);
}

function getCourierFactor(quality: number, randomChoice: <T>(choices: T[]) => T): number {
  switch (getQualityScenarioBand(quality)) {
    case 4:
      return randomChoice([0, 0.25, 0.5]);
    case 3:
      return randomChoice([-0.25, 0, 0.25]);
    case 2:
      return randomChoice([-0.5, -0.25, 0, 0.25]);
    case 1:
      return randomChoice([-0.75, -0.5, -0.25, 0]);
    default:
      return randomChoice([-1.0, -0.75, -0.5, -0.25]);
  }
}

function getComplexityFactor(
  input: Pick<ReviewRatingInput, 'itemsCount' | 'requiresContactlessDelivery' | 'isEcoFriendlyPackaging'>,
  quality: number,
  randomChoice: <T>(choices: T[]) => T,
): number {
  const isComplex = input.itemsCount >= 5 || input.requiresContactlessDelivery || input.isEcoFriendlyPackaging;

  if (!isComplex) {
    switch (getQualityScenarioBand(quality)) {
      case 4:
      case 3:
        return randomChoice([0, 0.25, 0.5]);
      case 2:
        return randomChoice([-0.25, 0, 0.25]);
      case 1:
        return randomChoice([-0.5, -0.25, 0]);
      default:
        return randomChoice([-0.75, -0.5, -0.25, 0]);
    }
  }

  switch (getQualityScenarioBand(quality)) {
    case 4:
    case 3:
      return randomChoice([-0.25, -0.25, 0, 0.25]);
    case 2:
      return randomChoice([-0.5, -0.25, -0.25, 0]);
    case 1:
      return randomChoice([-0.75, -0.5, -0.25, 0]);
    default:
      return randomChoice([-1.0, -0.75, -0.5, -0.25]);
  }
}

function getRandomNoise(quality: number, randomChoice: <T>(choices: T[]) => T): number {
  switch (getQualityScenarioBand(quality)) {
    case 4:
      return randomChoice([-0.25, 0, 0.25, 0.5]);
    case 3:
    case 2:
      return randomChoice([-0.5, -0.25, 0, 0.25, 0.5]);
    case 1:
      return randomChoice([-0.75, -0.5, -0.25, 0, 0.25]);
    default:
      return randomChoice([-1.0, -0.75, -0.5, -0.25, 0.25]);
  }
}

function getExcellenceBonus(
  input: Pick<ReviewRatingInput, 'delayHours' | 'itemsCount' | 'requiresContactlessDelivery' | 'isEcoFriendlyPackaging' | 'randomFloat' | 'randomChoice'>,
  quality: number,
): number {
  const simpleOrder = input.itemsCount <= 3 && !input.requiresContactlessDelivery && !input.isEcoFriendlyPackaging;
  const excellenceChance = quality >= 0.85 ? 0.08 : quality >= 0.65 ? 0.1 : quality >= 0.5 ? 0.05 : 0.01;

  if (input.delayHours < 1 && simpleOrder && input.randomFloat() < excellenceChance) {
    return input.randomChoice([0.25, 0.5]);
  }
  return 0;
}

function getIncidentPenalty(
  input: Pick<ReviewRatingInput, 'delayHours' | 'randomFloat' | 'randomChoice'>,
  quality: number,
): number {
  const incidentChance = quality >= 0.8 ? 0.02 : quality >= 0.5 ? 0.05 : quality >= 0.25 ? 0.09 : 0.14;

  if (input.delayHours < 3 && input.randomFloat() < incidentChance) {
    return input.randomChoice([0.5, 1.0, 1.5, 2.0]);
  }
  return 0;
}

export function buildReviewRating(input: ReviewRatingInput): { rating: number } {
  const quality = getEffectiveRestaurantQuality(input.restaurantKey);
  const baseScore = getBaseScore(quality, input.randomChoice);
  const restaurantFactor = getRestaurantFactor(quality, input.randomChoice);
  const courierFactor = getCourierFactor(quality, input.randomChoice);
  const complexityFactor = getComplexityFactor(input, quality, input.randomChoice);
  const randomNoise = getRandomNoise(quality, input.randomChoice);
  const excellenceBonus = getExcellenceBonus(input, quality);
  const incidentPenalty = getIncidentPenalty(input, quality);
  const delayPenalty = getReviewDelayPenalty(input.delayHours);

  return {
    rating: clampRating(
      baseScore
      + restaurantFactor
      + courierFactor
      + complexityFactor
      + randomNoise
      + excellenceBonus
      - delayPenalty
      - incidentPenalty,
    ),
  };
}
