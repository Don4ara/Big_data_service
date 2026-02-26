import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DataVitrineController } from './data-vitrine.controller';
import { DataVitrineService } from './data-vitrine.service';
import { GeocodingService } from './geocoding.service';

@Module({
  imports: [HttpModule],
  controllers: [DataVitrineController],
  providers: [DataVitrineService, GeocodingService],
})
export class DataVitrineModule { }
