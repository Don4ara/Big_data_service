import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DataVitrineModule } from './data-vitrine/data-vitrine.module';

@Module({
  imports: [DataVitrineModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
