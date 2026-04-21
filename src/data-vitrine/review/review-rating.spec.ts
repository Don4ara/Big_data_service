import {
  buildReviewRating,
  getDelayHoursChoices,
  getZeroDelayMinuteChoices,
} from './review-rating';

describe('review-rating', () => {
  const chooseFirst = <T>(choices: T[]): T => choices[0];

  function createCyclingChoice(): <T>(choices: T[]) => T {
    let cursor = 0;

    return <T>(choices: T[]): T => {
      const choice = choices[cursor % choices.length];
      cursor += 1;
      return choice;
    };
  }

  function createCyclingFloat(): () => number {
    const values = [0.04, 0.22, 0.41, 0.58, 0.77, 0.93];
    let cursor = 0;

    return () => {
      const value = values[cursor % values.length];
      cursor += 1;
      return value;
    };
  }

  function getMedian(values: number[]): number {
    const sorted = [...values].sort((left, right) => left - right);
    const middleIndex = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 0
      ? (sorted[middleIndex - 1] + sorted[middleIndex]) / 2
      : sorted[middleIndex];
  }

  function getAverage(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function buildHistogram(values: number[]) {
    const counts = new Map<number, number>();

    for (const value of values) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    return [...counts.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([rating, count]) => ({
        rating: rating.toFixed(2),
        count,
        share: `${((count / values.length) * 100).toFixed(1)}%`,
      }));
  }

  it('keeps ratings within 0.5..5.0 and on half-star steps', () => {
    const { rating } = buildReviewRating({
      quality: 0.82,
      delayHours: 1.25,
      itemsCount: 3,
      requiresContactlessDelivery: false,
      isEcoFriendlyPackaging: false,
      randomChoice: chooseFirst,
      randomFloat: () => 1,
    });

    expect(rating).toBeGreaterThanOrEqual(0.5);
    expect(rating).toBeLessThanOrEqual(5.0);
    expect(Number.isInteger(rating * 2)).toBe(true);
  });

  it('gives higher scores to higher-quality restaurants when randomness is fixed', () => {
    const baseInput = {
      delayHours: 0.5,
      itemsCount: 2,
      requiresContactlessDelivery: false,
      isEcoFriendlyPackaging: false,
      randomChoice: chooseFirst,
      randomFloat: () => 1,
    };

    const lowQuality = buildReviewRating({
      ...baseInput,
      quality: 0.12,
    }).rating;

    const highQuality = buildReviewRating({
      ...baseInput,
      quality: 0.88,
    }).rating;

    expect(highQuality).toBeGreaterThan(lowQuality);
  });

  it('penalizes long delivery delays', () => {
    const baseInput = {
      quality: 0.9,
      itemsCount: 2,
      requiresContactlessDelivery: false,
      isEcoFriendlyPackaging: false,
      randomChoice: <T>(choices: T[]) => choices[choices.length - 1],
      randomFloat: () => 1,
    };

    const quickDelivery = buildReviewRating({
      ...baseInput,
      delayHours: 0.25,
    }).rating;

    const delayedDelivery = buildReviewRating({
      ...baseInput,
      delayHours: 5.5,
    }).rating;

    expect(delayedDelivery).toBeLessThan(quickDelivery);
  });

  it('can reach the top of the scale for an excellent delivery', () => {
    const { rating } = buildReviewRating({
      quality: 0.99,
      delayHours: 0.1,
      itemsCount: 1,
      requiresContactlessDelivery: false,
      isEcoFriendlyPackaging: false,
      randomChoice: <T>(choices: T[]) => choices[choices.length - 1],
      randomFloat: () => 0.99,
    });

    expect(rating).toBe(5);
  });

  it('can drop below 1.0 for very poor deliveries', () => {
    const { rating } = buildReviewRating({
      quality: 0.02,
      delayHours: 2.5,
      itemsCount: 6,
      requiresContactlessDelivery: true,
      isEcoFriendlyPackaging: true,
      randomChoice: chooseFirst,
      randomFloat: () => 0,
    });

    expect(rating).toBeLessThanOrEqual(1);
    expect(rating).toBeGreaterThanOrEqual(0.5);
  });

  it('keeps top and bottom restaurant medians far from the center', () => {
    const topChoice = createCyclingChoice();
    const topFloat = createCyclingFloat();
    const topRatings = Array.from(
      { length: 61 },
      () =>
        buildReviewRating({
          quality: 0.97,
          delayHours: 0.25,
          itemsCount: 2,
          requiresContactlessDelivery: false,
          isEcoFriendlyPackaging: false,
          randomChoice: topChoice,
          randomFloat: topFloat,
        }).rating,
    );

    const weakChoice = createCyclingChoice();
    const weakFloat = createCyclingFloat();
    const weakRatings = Array.from(
      { length: 61 },
      () =>
        buildReviewRating({
          quality: 0.03,
          delayHours: 2.5,
          itemsCount: 6,
          requiresContactlessDelivery: true,
          isEcoFriendlyPackaging: true,
          randomChoice: weakChoice,
          randomFloat: weakFloat,
        }).rating,
    );

    expect(getMedian(topRatings)).toBeGreaterThanOrEqual(4.25);
    expect(getMedian(weakRatings)).toBeLessThanOrEqual(1);
  });

  it('keeps mid-tier restaurants above the floor under ordinary delays', () => {
    const midChoice = createCyclingChoice();
    const midFloat = createCyclingFloat();
    const midRatings = Array.from(
      { length: 61 },
      () =>
        buildReviewRating({
          quality: 0.58,
          delayHours: 1.5,
          itemsCount: 3,
          requiresContactlessDelivery: false,
          isEcoFriendlyPackaging: false,
          randomChoice: midChoice,
          randomFloat: midFloat,
        }).rating,
    );

    expect(getMedian(midRatings)).toBeGreaterThanOrEqual(2);
  });

  it('lets excellent restaurants sustain a high average score', () => {
    const topChoice = createCyclingChoice();
    const topFloat = createCyclingFloat();
    const topRatings = Array.from(
      { length: 80 },
      (_, index) =>
        buildReviewRating({
          quality: 0.97,
          delayHours: index % 6 === 0 ? 1 : 0.25,
          itemsCount: (index % 3) + 1,
          requiresContactlessDelivery: false,
          isEcoFriendlyPackaging: false,
          randomChoice: topChoice,
          randomFloat: topFloat,
        }).rating,
    );

    expect(getAverage(topRatings)).toBeGreaterThanOrEqual(4.25);
    expect(Math.max(...topRatings)).toBe(5);
  });

  it('lets premium near-perfect deliveries reach 5 under mixed randomness', () => {
    const premiumChoice = createCyclingChoice();
    const premiumFloat = createCyclingFloat();
    const ratings = Array.from(
      { length: 40 },
      () =>
        buildReviewRating({
          quality: 0.95,
          delayHours: 0.2,
          itemsCount: 2,
          requiresContactlessDelivery: false,
          isEcoFriendlyPackaging: false,
          randomChoice: premiumChoice,
          randomFloat: premiumFloat,
        }).rating,
    );

    expect(Math.max(...ratings)).toBe(5);
    expect(getMedian(ratings)).toBeGreaterThanOrEqual(4.25);
    expect(getAverage(ratings)).toBeGreaterThanOrEqual(4.55);
  });

  it('keeps elite mixed deliveries close to five stars on long runs', () => {
    const eliteChoice = createCyclingChoice();
    const eliteFloat = createCyclingFloat();
    const ratings = Array.from(
      { length: 120 },
      (_, index) =>
        buildReviewRating({
          quality: 0.982,
          delayHours: index % 10 === 0 ? 0.6 : index % 4 === 0 ? 0.35 : 0.15,
          itemsCount: index % 6 === 0 ? 5 : (index % 3) + 1,
          requiresContactlessDelivery: index % 7 === 0,
          isEcoFriendlyPackaging: index % 8 === 0,
          randomChoice: eliteChoice,
          randomFloat: eliteFloat,
        }).rating,
    );

    expect(Math.max(...ratings)).toBe(5);
    expect(getAverage(ratings)).toBeGreaterThanOrEqual(4.7);
    expect(getMedian(ratings)).toBeGreaterThanOrEqual(4.75);
  });

  it('prints analytical rating summaries for weak, mid and elite scenarios', () => {
    const scenarios = [
      {
        name: 'elite',
        input: {
          quality: 0.97,
          delayHours: 0.25,
          itemsCount: 2,
          requiresContactlessDelivery: false,
          isEcoFriendlyPackaging: false,
        },
      },
      {
        name: 'mid',
        input: {
          quality: 0.58,
          delayHours: 1.5,
          itemsCount: 3,
          requiresContactlessDelivery: false,
          isEcoFriendlyPackaging: false,
        },
      },
      {
        name: 'weak',
        input: {
          quality: 0.03,
          delayHours: 2.5,
          itemsCount: 6,
          requiresContactlessDelivery: true,
          isEcoFriendlyPackaging: true,
        },
      },
    ].map((scenario) => {
      const randomChoice = createCyclingChoice();
      const randomFloat = createCyclingFloat();
      const ratings = Array.from(
        { length: 80 },
        () =>
          buildReviewRating({
            ...scenario.input,
            randomChoice,
            randomFloat,
          }).rating,
      );

      return {
        scenario: scenario.name,
        ratings,
      };
    });

    console.log('\nRating analytics by scenario');
    console.table(
      scenarios.map(({ scenario, ratings }) => ({
        scenario,
        min: Math.min(...ratings).toFixed(2),
        p50: getMedian(ratings).toFixed(2),
        avg: getAverage(ratings).toFixed(2),
        max: Math.max(...ratings).toFixed(2),
      })),
    );

    for (const { scenario, ratings } of scenarios) {
      console.log(`Rating histogram for ${scenario}`);
      console.table(buildHistogram(ratings));
    }

    expect(scenarios).toHaveLength(3);
  });

  it('uses harsher delay buckets for higher lateness profiles', () => {
    const lowLatenessHours = getDelayHoursChoices(0.1);
    const highLatenessHours = getDelayHoursChoices(0.9);
    const lowLatenessMinutes = getZeroDelayMinuteChoices(0.1);
    const highLatenessMinutes = getZeroDelayMinuteChoices(0.9);

    expect(Math.max(...highLatenessHours)).toBeGreaterThan(
      Math.max(...lowLatenessHours),
    );
    expect(Math.min(...highLatenessMinutes)).toBeGreaterThanOrEqual(
      Math.min(...lowLatenessMinutes),
    );
  });
});
