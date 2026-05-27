export const SUBTOTAL_ERROR_PROBABILITY = 0.01;
const MIN_SUBTOTAL_ERROR_RATE = 0.05;
const MAX_SUBTOTAL_ERROR_RATE = 0.15;

type SubtotalErrorOptions = {
  roll?: () => number;
  randomRate?: (min: number, max: number) => number;
};

export function applySubtotalErrorChance(
  subtotal: number,
  options: SubtotalErrorOptions = {},
): number {
  const roundedSubtotal = roundMoney(subtotal);
  const roll = options.roll ?? Math.random;

  if (roll() >= SUBTOTAL_ERROR_PROBABILITY) {
    return roundedSubtotal;
  }

  const randomRate = options.randomRate ?? defaultRandomRate;
  const errorRate = randomRate(
    MIN_SUBTOTAL_ERROR_RATE,
    MAX_SUBTOTAL_ERROR_RATE,
  );
  const errorAmount = roundMoney(roundedSubtotal * errorRate);
  const direction = roll() < 0.5 ? -1 : 1;
  const brokenSubtotal = Math.max(
    0,
    roundedSubtotal + direction * errorAmount,
  );

  return roundMoney(brokenSubtotal);
}

function defaultRandomRate(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function roundMoney(value: number): number {
  return parseFloat(value.toFixed(2));
}
