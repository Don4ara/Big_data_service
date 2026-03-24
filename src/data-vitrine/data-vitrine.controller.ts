import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Sse,
  MessageEvent,
  HttpException,
  Ip,
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
    return interval(3000).pipe(
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

  private requestCounts = new Map<string, number[]>();

  private async antiScrapeGuard(ip: string) {
    // 1. Искусственная случайная задержка (от 100 до 600 мс)
    await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 100));

    // 2. Rate-limiter (Максимум 5 запросов за 10 секунд)
    const now = Date.now();
    const windowMs = 10000;
    const maxRequests = 5;

    if (!this.requestCounts.has(ip)) {
      this.requestCounts.set(ip, []);
    }

    let logs = this.requestCounts.get(ip) || [];
    logs = logs.filter(time => now - time < windowMs);
    logs.push(now);
    this.requestCounts.set(ip, logs);

    if (logs.length > maxRequests) {
      throw new HttpException({
        error: 'CAPTCHA_REQUIRED',
        message: 'Аномальная активность. Подтвердите, что вы не робот.',
      }, 429);
    }
  }

  // Снятие блокировки (решение капчи)
  @Post('solve-captcha')
  solveCaptcha(@Ip() ip: string) {
    this.requestCounts.delete(ip);
    return { success: true };
  }

  // 4. Получить заказы из БД с пагинацией и поиском
  @Get('orders/db')
  async getOrdersFromDb(
    @Ip() ip: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('payment') payment?: string,
  ) {
    await this.antiScrapeGuard(ip);

    const pageNum = Math.max(1, parseInt(page || '1', 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10)));
    return this.dataVitrineService.getOrdersPaginated(pageNum, limitNum, search || undefined, status || undefined, payment || undefined);
  }

  // 5. Добавить свой собственный заказ вручную
  @Post('orders')
  addManualOrder(@Body() orderData: any) {
    return this.dataVitrineService.addOrder(orderData);
  }
}
