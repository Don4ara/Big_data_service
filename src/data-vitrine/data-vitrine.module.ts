import { Module } from '@nestjs/common';
import { DataVitrineController } from './data-vitrine.controller';
import { DataVitrineService } from './data-vitrine.service';

@Module({
  controllers: [DataVitrineController],
  providers: [DataVitrineService],
})
export class DataVitrineModule {}
