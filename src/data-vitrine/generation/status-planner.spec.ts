import {
  buildStatusPlan,
  buildStatusQuotaProfile,
  shouldMatchRestaurantCity,
  weightedStatusChoice,
} from './status-planner';

describe('status-planner', () => {
  const deliveredStatus = '\u0414\u043e\u0441\u0442\u0430\u0432\u043b\u0435\u043d';
  const deliveringStatus = '\u0414\u043e\u0441\u0442\u0430\u0432\u043b\u044f\u0435\u0442\u0441\u044f';

  function buildStatusBreakdown(statuses: string[]) {
    const counts = new Map<string, number>();

    for (const status of statuses) {
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }

    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([status, count]) => ({
        status,
        count,
        share: `${((count / statuses.length) * 100).toFixed(2)}%`,
      }));
  }

  it('keeps delivered and delivering rates within 0.99 percentage points of target', () => {
    const result = buildStatusQuotaProfile({
      existingProfile: null,
      generationBatchCounter: 1,
      marketDeliveredRateBias: 0,
      marketDeliveringRateBias: 0,
      marketQualityBias: 0,
      marketLatenessBias: 0,
      randomFloat: (min, max) => (min + max) / 2,
      randomInt: (min) => min,
    });

    expect(result.profile.deliveredRate).toBeGreaterThanOrEqual(0.0901);
    expect(result.profile.deliveredRate).toBeLessThanOrEqual(0.1099);
    expect(result.profile.deliveringRate).toBeGreaterThanOrEqual(0.0201);
    expect(result.profile.deliveringRate).toBeLessThanOrEqual(0.0399);

    const pendingSharesTotal =
      result.profile.newShare +
      result.profile.cookingShare +
      result.profile.handedOffShare +
      result.profile.cancelledShare;

    expect(pendingSharesTotal).toBeCloseTo(1, 10);
  });

  it('reuses an existing quota profile until it expires', () => {
    const profile = {
      deliveredRate: 0.1,
      deliveringRate: 0.03,
      newShare: 0.4,
      cookingShare: 0.3,
      handedOffShare: 0.2,
      cancelledShare: 0.1,
      nextRefreshBatch: 10,
    };

    const result = buildStatusQuotaProfile({
      existingProfile: profile,
      generationBatchCounter: 3,
      marketDeliveredRateBias: 0,
      marketDeliveringRateBias: 0,
      marketQualityBias: 0,
      marketLatenessBias: 0,
      randomFloat: () => {
        throw new Error('should not be called');
      },
      randomInt: () => {
        throw new Error('should not be called');
      },
    });

    expect(result.refreshed).toBe(false);
    expect(result.profile).toBe(profile);
  });

  it('maps pending statuses according to weighted thresholds', () => {
    const profile = {
      newShare: 0.5,
      cookingShare: 0.2,
      handedOffShare: 0.2,
      cancelledShare: 0.1,
    };

    expect(weightedStatusChoice(profile, 0.1)).toBe('\u041d\u043e\u0432\u044b\u0439');
    expect(weightedStatusChoice(profile, 0.65)).toBe('\u0413\u043e\u0442\u043e\u0432\u0438\u0442\u0441\u044f');
    expect(weightedStatusChoice(profile, 0.85)).toBe('\u041f\u0435\u0440\u0435\u0434\u0430\u043d \u043a\u0443\u0440\u044c\u0435\u0440\u0443');
    expect(weightedStatusChoice(profile, 0.97)).toBe('\u041e\u0442\u043c\u0435\u043d\u0435\u043d');
  });

  it('carries fractional delivered and delivering quotas across batches', () => {
    const quotaProfile = {
      deliveredRate: 0.1046,
      deliveringRate: 0.0354,
      newShare: 0.45,
      cookingShare: 0.25,
      handedOffShare: 0.2,
      cancelledShare: 0.1,
      nextRefreshBatch: Number.MAX_SAFE_INTEGER,
    };

    let deliveredQuotaCarry = 0;
    let deliveringQuotaCarry = 0;
    const deliveredCounts: number[] = [];
    const deliveringCounts: number[] = [];

    for (let index = 0; index < 5; index += 1) {
      const result = buildStatusPlan({
        count: 100,
        quotaProfile,
        deliveredQuotaCarry,
        deliveringQuotaCarry,
        roll: () => 0,
      });

      deliveredQuotaCarry = result.deliveredQuotaCarry;
      deliveringQuotaCarry = result.deliveringQuotaCarry;
      deliveredCounts.push(
        result.statuses.filter((status) => status === deliveredStatus).length,
      );
      deliveringCounts.push(
        result.statuses.filter((status) => status === deliveringStatus).length,
      );
      expect(result.statuses).toHaveLength(100);
    }

    expect(deliveredCounts).toEqual([10, 10, 11, 10, 11]);
    expect(deliveringCounts).toEqual([3, 4, 3, 4, 3]);
  });

  it('keeps status-to-city matching rules deterministic by status', () => {
    expect(shouldMatchRestaurantCity(deliveredStatus, 0.99)).toBe(true);
    expect(shouldMatchRestaurantCity(deliveringStatus, 0.99)).toBe(true);
    expect(
      shouldMatchRestaurantCity('\u041f\u0435\u0440\u0435\u0434\u0430\u043d \u043a\u0443\u0440\u044c\u0435\u0440\u0443', 0.81),
    ).toBe(true);
    expect(
      shouldMatchRestaurantCity('\u041f\u0435\u0440\u0435\u0434\u0430\u043d \u043a\u0443\u0440\u044c\u0435\u0440\u0443', 0.83),
    ).toBe(false);
    expect(shouldMatchRestaurantCity('\u041e\u0442\u043c\u0435\u043d\u0435\u043d', 0.27)).toBe(true);
    expect(shouldMatchRestaurantCity('\u041e\u0442\u043c\u0435\u043d\u0435\u043d', 0.29)).toBe(false);
  });

  it('prints analytical quota and batch status summaries', () => {
    const quotaProfile = buildStatusQuotaProfile({
      existingProfile: null,
      generationBatchCounter: 1,
      marketDeliveredRateBias: 0.0025,
      marketDeliveringRateBias: -0.0015,
      marketQualityBias: 0.04,
      marketLatenessBias: -0.02,
      randomFloat: (min, max) => (min + max) / 2,
      randomInt: (min) => min,
    }).profile;

    let deliveredQuotaCarry = 0;
    let deliveringQuotaCarry = 0;
    const batches = Array.from({ length: 6 }, (_, index) => {
      const result = buildStatusPlan({
        count: 120,
        quotaProfile,
        deliveredQuotaCarry,
        deliveringQuotaCarry,
        roll: () => 0.35,
      });

      deliveredQuotaCarry = result.deliveredQuotaCarry;
      deliveringQuotaCarry = result.deliveringQuotaCarry;

      return {
        batch: index + 1,
        statuses: result.statuses,
      };
    });

    const allStatuses = batches.flatMap((batch) => batch.statuses);

    console.log('\nStatus quota profile');
    console.table([
      {
        deliveredRate: `${(quotaProfile.deliveredRate * 100).toFixed(2)}%`,
        deliveringRate: `${(quotaProfile.deliveringRate * 100).toFixed(2)}%`,
        newShare: `${(quotaProfile.newShare * 100).toFixed(1)}%`,
        cookingShare: `${(quotaProfile.cookingShare * 100).toFixed(1)}%`,
        handedOffShare: `${(quotaProfile.handedOffShare * 100).toFixed(1)}%`,
        cancelledShare: `${(quotaProfile.cancelledShare * 100).toFixed(1)}%`,
      },
    ]);

    console.log('Status distribution across analytical batches');
    console.table(buildStatusBreakdown(allStatuses));

    console.log('Per-batch delivered/delivering counts');
    console.table(
      batches.map((batch) => ({
        batch: batch.batch,
        delivered: batch.statuses.filter((status) => status === deliveredStatus).length,
        delivering: batch.statuses.filter((status) => status === deliveringStatus).length,
      })),
    );

    expect(allStatuses).toHaveLength(720);
  });
});
