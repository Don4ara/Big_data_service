import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DataVitrineModule } from './data-vitrine/data-vitrine.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DataVitrineModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
