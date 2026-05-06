import { Logger } from '@nestjs/common';

export function logStartupRoutes(appUrl: string): void {
  const logger = new Logger('StartupRoutes');
  const publicUrl = normalizeAppUrl(appUrl);

  console.log('');
  console.log('');
  logger.log(`Application URL: ${publicUrl}`);
  logger.log('Available endpoints:');
  logger.log(`GET  ${publicUrl}/                          - базовая проверка сервиса`);
  logger.log(
    `GET  ${publicUrl}/data-vitrine/generate       - сгенерировать и вернуть батч заказов`,
  );
  logger.log(
    `GET  ${publicUrl}/data-vitrine/generate/kafka - сгенерировать батч и отправить его в Kafka`,
  );
  logger.log(
    `GET  ${publicUrl}/data-vitrine/stream         - поток заказов через SSE`,
  );
  logger.log(
    `GET  ${publicUrl}/data-vitrine/orders         - получить заказы из in-memory хранилища`,
  );
  logger.log(
    `GET  ${publicUrl}/data-vitrine/orders/db      - получить заказы из БД с пагинацией и поиском`,
  );
  logger.log(
    `POST ${publicUrl}/data-vitrine/orders         - вручную добавить заказ`,
  );
  logger.log(
    `POST ${publicUrl}/data-vitrine/solve-captcha  - снять антискрапинг-блокировку`,
  );
}

function normalizeAppUrl(appUrl: string): string {
  return appUrl
    .replace('://[::1]', '://localhost')
    .replace('://[::]', '://localhost')
    .replace('://0.0.0.0', '://localhost');
}
