export const SPECIAL_INSTRUCTIONS = [
  'Без лука, пожалуйста',
  'Поострее',
  'Не класть салфетки',
  'Меньше льда',
  'Соус отдельно',
  'Приборы на 3 персоны',
  null,
  null,
  null,
] as const;

export const DELIVERY_FEE_OPTIONS = [100, 150, 200, 0, 300, 49] as const;
export const SERVICE_FEE_OPTIONS = [29, 39, 49, 0] as const;
export const PAYMENT_METHODS = [
  'CARD_ONLINE',
  'CASH',
  'APPLE_PAY',
  'GOOGLE_PAY',
  'SBP',
] as const;
export const TRANSPORT_TYPES = [
  'bicycle',
  'car',
  'walking',
  'scooter',
] as const;
export const MONEY_SUFFIXES = ['руб.', 'р.', 'рублей', '₽'] as const;
