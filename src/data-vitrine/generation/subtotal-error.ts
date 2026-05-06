export const SUBTOTAL_ERROR_PROBABILITY = 0.01;

type SubtotalErrorOptions = {
  roll?: () => number;
  randomMoney?: (min: number, max: number) => number;
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

  const randomMoney = options.randomMoney ?? defaultRandomMoney;
  const maxError = Math.max(1, roundedSubtotal * 0.12);
  const errorAmount = randomMoney(1, maxError);
  const direction = roll() < 0.5 ? -1 : 1;
  const brokenSubtotal = Math.max(
    0,
    roundedSubtotal + direction * errorAmount,
  );

  return roundMoney(brokenSubtotal);
}

function defaultRandomMoney(min: number, max: number): number {
  return roundMoney(min + Math.random() * (max - min));
}

function roundMoney(value: number): number {
  return parseFloat(value.toFixed(2));
}
