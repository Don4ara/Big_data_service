import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { DataVitrineService } from './data-vitrine.service';
import { Observable, interval, from } from 'rxjs';
import { switchMap, map } from 'rxjs/operators';

@Controller('data-vitrine')
export class DataVitrineController {
  constructor(private readonly dataVitrineService: DataVitrineService) { }

  // 1. Сгенерировать новые заказы и запомнить их (разово)
  @Get('generate')
  async generateOrders(@Query('count') count: string) {
    let countNum = parseInt(count, 10);
    if (isNaN(countNum) || countNum < 1) {
      countNum = 10;
    } else if (countNum > 5000) {
      countNum = 5000;
    }
    return this.dataVitrineService.generateOrders(countNum);
  }

  // 2. БЕСКОНЕЧНЫЙ ПОТОК ЗАКАЗОВ В РЕАЛЬНОМ ВРЕМЕНИ (Server-Sent Events)
  @Sse('stream')
  streamOrders(): Observable<MessageEvent> {
    // Каждые 3 секунды генерируем от 1 до 3 заказов (учитываем задержки API)
    return interval(2000).pipe(
      switchMap((_) => {
        const randomCount = Math.floor(Math.random() * 3) + 1;
        return from(this.dataVitrineService.generateOrders(randomCount));
      }),
      map((newOrders) => ({
        data: newOrders,
      } as MessageEvent)),
    );
  }

  // 3. Получить ВСЕ заказы, которые были сохранены в памяти
  @Get('orders')
  getAllOrders() {
    return this.dataVitrineService.getAllOrders();
  }

  // 4. Добавить свой собственный заказ вручную
  @Post('orders')
  addManualOrder(@Body() orderData: any) {
    return this.dataVitrineService.addOrder(orderData);
  }
}
