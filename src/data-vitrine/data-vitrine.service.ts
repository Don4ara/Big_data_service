import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OrderDbService } from './services/order-db.service';
import { OrderGeneratorService } from './services/order-generator.service';

@Injectable()
export class DataVitrineService implements OnModuleInit {
  private readonly logger = new Logger(DataVitrineService.name);
  private savedOrders: any[] = [];
  private static readonly MAX_IN_MEMORY = 500;

  constructor(
    private readonly orderDbService: OrderDbService,
    private readonly orderGeneratorService: OrderGeneratorService,
  ) {}

  async onModuleInit() {
    await this.orderDbService.seedRestaurants();

    if (process.env.AUTO_GENERATE === 'true') {
      this.startAutoGeneration();
    }
  }

  private startAutoGeneration() {
    const batchSize = parseInt(process.env.AUTO_GENERATE_BATCH_SIZE || '50', 10);
    const intervalMs = parseInt(process.env.AUTO_GENERATE_INTERVAL || '5000', 10);
    this.logger.log(`[Beast Mode] Запуск автоматической генерации: ${batchSize} заказов каждые ${intervalMs}мс`);

    setInterval(async () => {
      try {
        await this.generateOrders(batchSize);
        this.logger.log(`✅ [Авто-Воркер] Сгенерировано и сохранено ${batchSize} заказов.`);
      } catch (err) {
        this.logger.error('❌ Ошибка в автоматической генерации', err);
      }
    }, intervalMs);
  }

  async generateOrders(count: number): Promise<any[]> {
    this.logger.log(`🛠 [Воркер] Начинаю подготовку ${count} заказов (параллельно)...`);

    const promises = Array.from({ length: count }).map(() =>
      this.orderGeneratorService.generateSingleOrder(this.orderDbService.dbRestaurantsCache)
    );
    let newOrders = await Promise.all(promises);
    newOrders = newOrders.filter(order => order !== null);

    if (newOrders.length === 0) {
      this.logger.warn('⚠️ [Воркер] Ни один из заказов не сгенерирован (вероятно, кончились лимиты API).');
      return [];
    }

    this.savedOrders.push(...newOrders);
    if (this.savedOrders.length > DataVitrineService.MAX_IN_MEMORY) {
      this.savedOrders = this.savedOrders.slice(-DataVitrineService.MAX_IN_MEMORY);
    }

    try {
      this.logger.log(`📤 [Воркер] Отправляю ${newOrders.length} заказов в базу данных...`);
      await this.orderDbService.saveOrdersToDb(newOrders);
      this.logger.log(`✅ [Воркер] Записано ${newOrders.length} заказов в БД!`);
    } catch (err) {
      this.logger.error('❌ Ошибка записи в БД', err);
    }

    return newOrders;
  }

  getAllOrders(): any[] {
    return this.savedOrders;
  }

  async getOrdersPaginated(page: number, limit: number, search?: string, statusFilter?: string, paymentFilter?: string) {
    return this.orderDbService.getOrdersPaginated(page, limit, search, statusFilter, paymentFilter);
  }

  addOrder(order: any): any {
    const savedOrder = {
      ...order,
      createdAt: order.createdAt || new Date().toISOString(),
      updatedAt: order.updatedAt || new Date().toISOString(),
    };
    this.savedOrders.push(savedOrder);
    return savedOrder;
  }
}
