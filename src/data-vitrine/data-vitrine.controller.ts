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
import { KafkaProducerService } from './kafka/kafka-producer.service';
import { Observable, interval, from } from 'rxjs';
import { switchMap, map } from 'rxjs/operators';

@Controller('data-vitrine')
export class DataVitrineController {
  constructor(
    private readonly dataVitrineService: DataVitrineService,
    private readonly kafkaProducerService: KafkaProducerService,
  ) {}

  // 1. Сгенерировать новые заказы и запомнить их (разово)
  @Get('generate')
  async generateOrders(@Query('count') count: string) {
    return this.dataVitrineService.generateOrders(this.parseCount(count));
  }

  // 1.1. Сгенерировать новые заказы и отправить их в Kafka
  @Get('generate/kafka')
  async generateOrdersToKafka(@Query('count') count: string) {
    const orders = await this.dataVitrineService.generateOrders(
      this.parseCount(count),
      {
        saveToMemory: false,
        persistToDb: false,
      },
    );
    await this.kafkaProducerService.publishGeneratedOrders(
      orders,
      'GET /data-vitrine/generate/kafka',
    );

    return {
      sent: orders.length,
      topic: this.kafkaProducerService.getTopic(),
      kafkaEnabled: this.kafkaProducerService.isEnabled(),
      orders,
    };
  }

  // 2. БЕСКОНЕЧНЫЙ ПОТОК ЗАКАЗОВ В РЕАЛЬНОМ ВРЕМЕНИ (Server-Sent Events)
  @Sse('stream')
  streamOrders(): Observable<MessageEvent> {
    // Каждые 3 секунды генерируем от 1 до 3 заказов (учитываем задержки API)
    return interval(3000).pipe(
      switchMap((_) => {
        const randomCount = Math.floor(Math.random() * 3) + 1;
        return from(this.dataVitrineService.generateOrders(randomCount));
      }),
      map(
        (newOrders) =>
          ({
            data: newOrders,
          }) as MessageEvent,
      ),
    );
  }

  // 3. Получить ВСЕ заказы, которые были сохранены в памяти
  @Get('orders')
  getAllOrders() {
    return this.dataVitrineService.getAllOrders();
  }

  // 4. Получить заказы из БД с пагинацией и поиском
  @Get('orders/db')
  async getOrdersFromDb(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('payment') payment?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10)));
    return this.dataVitrineService.getOrdersPaginated(
      pageNum,
      limitNum,
      search || undefined,
      status || undefined,
      payment || undefined,
    );
  }

  // 5. Добавить свой собственный заказ вручную
  @Post('orders')
  addManualOrder(@Body() orderData: any) {
    return this.dataVitrineService.addOrder(orderData);
  }

  private parseCount(count: string): number {
    let countNum = parseInt(count, 10);
    if (isNaN(countNum) || countNum < 1) {
      countNum = 10;
    } else if (countNum > 5000) {
      countNum = 5000;
    }

    return countNum;
  }
}
