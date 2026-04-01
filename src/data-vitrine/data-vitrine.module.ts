import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DataVitrineController } from './data-vitrine.controller';
import { DataVitrineService } from './data-vitrine.service';
import { GeocodingService } from './geocoding.service';
import { OrderDbService } from './services/order-db.service';
import { OrderGeneratorService } from './services/order-generator.service';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [HttpModule],
  controllers: [DataVitrineController],
  providers: [
    DataVitrineService,
    GeocodingService,
    PrismaService,
    OrderDbService,
    OrderGeneratorService,
  ],
})
export class DataVitrineModule {}
