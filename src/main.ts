import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { logStartupRoutes } from './logger/startup-routes.logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  await app.listen(process.env.PORT ?? 3000);

  const appUrl = await app.getUrl();
  logStartupRoutes(appUrl);
}
void bootstrap();
