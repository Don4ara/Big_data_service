const ORDER_DATE_START_MS = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
const ORDER_DATE_END_MS = Date.UTC(2026, 11, 29, 23, 59, 59, 999);

export type SpoiledDateValue = string | number;

export function buildRandomOrderDate2026(randomFloat = Math.random): Date {
  const roll = Math.max(0, Math.min(1, randomFloat()));
  const timestamp =
    roll >= 1
      ? ORDER_DATE_END_MS
      : ORDER_DATE_START_MS +
        Math.floor(roll * (ORDER_DATE_END_MS - ORDER_DATE_START_MS + 1));

  return new Date(timestamp);
}

export function formatSpoiledDateValue(
  date: Date,
  randomFloat = Math.random,
): SpoiledDateValue {
  const roll = randomFloat();

  if (roll < 0.25) {
    return date.toISOString();
  }

  if (roll < 0.5) {
    return Math.floor(date.getTime() / 1000);
  }

  const calendarDate = formatCalendarDate(date);

  if (roll < 0.75) {
    return calendarDate;
  }

  return `${calendarDate} ${padTwoDigits(date.getUTCHours())}:${padTwoDigits(
    date.getUTCMinutes(),
  )}`;
}

function padTwoDigits(value: number): string {
  return value.toString().padStart(2, '0');
}

function formatCalendarDate(date: Date): string {
  return `${padTwoDigits(date.getUTCDate())}.${padTwoDigits(
    date.getUTCMonth() + 1,
  )}.${date.getUTCFullYear()}`;
}
