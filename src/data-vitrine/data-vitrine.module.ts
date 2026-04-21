import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DataVitrineController } from './data-vitrine.controller';
import { DataVitrineService } from './data-vitrine.service';
import { GeocodingService } from './geo/geocoding.service';
import { PrismaService } from '../prisma.service';
import { SharedMarketStateService } from './market/shared-market-state.service';

@Module({
  imports: [HttpModule],
  controllers: [DataVitrineController],
  providers: [
    DataVitrineService,
    GeocodingService,
    PrismaService,
    SharedMarketStateService,
  ],
})
export class DataVitrineModule { }
