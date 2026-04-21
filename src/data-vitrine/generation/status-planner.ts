export type OrderStatus =
  | 'Новый'
  | 'Готовится'
  | 'Передан курьеру'
  | 'Отменен'
  | 'Доставлен'
  | 'Доставляется';

export type StatusQuotaProfile = {
  deliveredRate: number;
  deliveringRate: number;
  newShare: number;
  cookingShare: number;
  handedOffShare: number;
  cancelledShare: number;
  nextRefreshBatch: number;
};

type RandomFloatFn = (min: number, max: number) => number;
type RandomIntFn = (min: number, max: number) => number;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function weightedStatusChoice(
  profile: Pick<
    StatusQuotaProfile,
    'newShare' | 'cookingShare' | 'handedOffShare' | 'cancelledShare'
  >,
  roll: number,
): OrderStatus {
  let cursor = profile.newShare;
  if (roll < cursor) return 'Новый';

  cursor += profile.cookingShare;
  if (roll < cursor) return 'Готовится';

  cursor += profile.handedOffShare;
  if (roll < cursor) return 'Передан курьеру';

  return 'Отменен';
}

export function buildStatusQuotaProfile(input: {
  existingProfile: StatusQuotaProfile | null;
  generationBatchCounter: number;
  marketDeliveredRateBias: number;
  marketDeliveringRateBias: number;
  marketQualityBias: number;
  marketLatenessBias: number;
  randomFloat: RandomFloatFn;
  randomInt: RandomIntFn;
}): { profile: StatusQuotaProfile; refreshed: boolean } {
  if (
    input.existingProfile &&
    input.generationBatchCounter < input.existingProfile.nextRefreshBatch
  ) {
    return {
      profile: input.existingProfile,
      refreshed: false,
    };
  }

  const maxDeviation = 0.0099;
  const localDriftRange = 0.0044;

  const deliveredRate = clamp(
    0.1 +
      input.marketDeliveredRateBias +
      input.randomFloat(-localDriftRange, localDriftRange),
    0.1 - maxDeviation,
    0.1 + maxDeviation,
  );

  const deliveringRate = clamp(
    0.03 +
      input.marketDeliveringRateBias +
      input.randomFloat(-localDriftRange, localDriftRange),
    0.03 - maxDeviation,
    0.03 + maxDeviation,
  );

  const newWeight = Math.max(
    0.2,
    1.45 +
      input.randomFloat(-0.28, 0.72) +
      Math.max(0, -input.marketQualityBias) * 0.6,
  );
  const cookingWeight = Math.max(
    0.2,
    1.0 +
      input.randomFloat(-0.32, 0.46) +
      Math.max(0, input.marketLatenessBias) * 0.2,
  );
  const handedOffWeight = Math.max(
    0.2,
    0.86 +
      input.randomFloat(-0.3, 0.42) +
      Math.max(0, input.marketQualityBias) * 0.16,
  );
  const cancelledWeight = Math.max(
    0.18,
    0.62 +
      input.randomFloat(-0.2, 0.36) +
      Math.max(0, input.marketLatenessBias) * 0.45,
  );
  const pendingWeightsSum =
    newWeight + cookingWeight + handedOffWeight + cancelledWeight;

  return {
    refreshed: true,
    profile: {
      deliveredRate,
      deliveringRate,
      newShare: newWeight / pendingWeightsSum,
      cookingShare: cookingWeight / pendingWeightsSum,
      handedOffShare: handedOffWeight / pendingWeightsSum,
      cancelledShare: cancelledWeight / pendingWeightsSum,
      nextRefreshBatch: input.generationBatchCounter + input.randomInt(4, 11),
    },
  };
}

export function buildStatusPlan(input: {
  count: number;
  quotaProfile: StatusQuotaProfile;
  deliveredQuotaCarry: number;
  deliveringQuotaCarry: number;
  roll: () => number;
}): {
  statuses: OrderStatus[];
  deliveredQuotaCarry: number;
  deliveringQuotaCarry: number;
} {
  const rawDelivered =
    input.count * input.quotaProfile.deliveredRate + input.deliveredQuotaCarry;
  const deliveredCount = Math.max(
    0,
    Math.min(input.count, Math.floor(rawDelivered)),
  );

  const remainingAfterDelivered = Math.max(0, input.count - deliveredCount);
  const rawDelivering =
    input.count * input.quotaProfile.deliveringRate + input.deliveringQuotaCarry;
  const deliveringCount = Math.max(
    0,
    Math.min(remainingAfterDelivered, Math.floor(rawDelivering)),
  );

  const statuses = new Array<OrderStatus>(input.count);
  let cursor = 0;

  for (let index = 0; index < deliveredCount; index += 1) {
    statuses[cursor] = 'Доставлен';
    cursor += 1;
  }

  for (let index = 0; index < deliveringCount; index += 1) {
    statuses[cursor] = 'Доставляется';
    cursor += 1;
  }

  for (; cursor < input.count; cursor += 1) {
    statuses[cursor] = weightedStatusChoice(input.quotaProfile, input.roll());
  }

  for (let index = statuses.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(input.roll() * (index + 1));
    [statuses[index], statuses[swapIndex]] = [
      statuses[swapIndex],
      statuses[index],
    ];
  }

  return {
    statuses,
    deliveredQuotaCarry: rawDelivered - deliveredCount,
    deliveringQuotaCarry: rawDelivering - deliveringCount,
  };
}

export function shouldMatchRestaurantCity(
  status: OrderStatus,
  roll: number,
): boolean {
  if (status === 'Доставлен' || status === 'Доставляется') {
    return true;
  }

  if (status === 'Передан курьеру') {
    return roll < 0.82;
  }

  if (status === 'Готовится') {
    return roll < 0.7;
  }

  if (status === 'Новый') {
    return roll < 0.58;
  }

  return roll < 0.28;
}
