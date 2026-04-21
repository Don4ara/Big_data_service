import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { fakerRU as faker } from '@faker-js/faker';
import {
  dishAdjectives,
  dishNouns,
  desserts,
  dishCategories,
  restaurants,
  positiveReviews,
  negativeReviews,
  customerNames,
  courierNames,
} from './generation/mock-dictionaries';
import { GeocodingService } from './geo/geocoding.service';
import { PrismaService } from '../prisma.service';
import {
  DELIVERY_FEE_OPTIONS,
  MONEY_SUFFIXES,
  PAYMENT_METHODS,
  SERVICE_FEE_OPTIONS,
  SPECIAL_INSTRUCTIONS,
  TRANSPORT_TYPES,
} from './generation/generation.constants';
import { buildOrderCreateData } from './persistence/order-persistence';
import {
  createRestaurantRuntimeProfile,
  refreshRestaurantRuntimeProfile,
  RestaurantRuntimeProfile,
} from './market/restaurant-profile';
import {
  buildReviewRating,
  getDelayHoursChoices,
  getZeroDelayMinuteChoices,
} from './review/review-rating';
import {
  buildStatusPlan,
  buildStatusQuotaProfile,
  OrderStatus,
  shouldMatchRestaurantCity,
  StatusQuotaProfile,
} from './generation/status-planner';
import { createDeterministicRandom } from './market/deterministic-random';
import { SharedMarketStateService } from './market/shared-market-state.service';
import { SharedMarketSeasonState } from './market/market-season';
import { buildMarketSeedScope } from './market/market-scope';
import { eachInChunks, mapWithConcurrency } from './generation/async-batch';

@Injectable()
export class DataVitrineService implements OnModuleInit {
  private readonly logger = new Logger(DataVitrineService.name);
  // Хранилище сгенерированных и добавленных вручную заказов (в памяти)
  // Ограничено MAX_IN_MEMORY записями для защиты от утечки памяти
  private savedOrders: any[] = [];
  private static readonly MAX_IN_MEMORY = 500;
  private dbRestaurantsCache: any[] = [];
  private dbWriteQueue: Promise<void> = Promise.resolve();
  private queuedDbBatches = 0;
  private isDbWriteActive = false;
  private isGenerating = false;
  private autoGenerationTimer: NodeJS.Timeout | null = null;
  private autoGenerationBatchSize = 0;
  private autoGenerationIntervalMs = 0;
  private readonly maxQueuedDbBatches = parseInt(
    process.env.MAX_QUEUED_DB_BATCHES || '4',
    10,
  );
  private readonly orderGenerationConcurrency = parseInt(
    process.env.ORDER_GENERATION_CONCURRENCY || '24',
    10,
  );
  private readonly dbWriteChunkSize = parseInt(
    process.env.DB_WRITE_CHUNK_SIZE || '20',
    10,
  );
  private readonly marketSeedScope = buildMarketSeedScope({
    marketProfileSeed: process.env.MARKET_PROFILE_SEED,
    marketRunSeed: process.env.MARKET_RUN_SEED,
  });
  private readonly marketProfileSeed = this.marketSeedScope.marketProfileSeed;
  private readonly marketRunSeed = this.marketSeedScope.marketRunSeed;
  private readonly sharedMarketSeed = this.marketSeedScope.sharedStateSeed;
  private generationBatchCounter = 0;
  private currentGlobalBatchNumber = 0;
  private currentSeasonStartedAtBatch = 0;
  private activeGenerationProfileSeed: string | null = null;
  private deliveredQuotaCarry = 0;
  private deliveringQuotaCarry = 0;
  private marketQualityBias = 0;
  private marketLatenessBias = 0;
  private marketDeliveredRateBias = 0;
  private marketDeliveringRateBias = 0;
  private restaurantCityById = new Map<number, string>();
  private restaurantRuntimeProfiles = new Map<
    number,
    RestaurantRuntimeProfile
  >();
  private statusQuotaProfile: StatusQuotaProfile | null = null;

  constructor(
    private readonly geocodingService: GeocodingService,
    private readonly prisma: PrismaService,
    private readonly sharedMarketStateService: SharedMarketStateService,
  ) {}

  // При старте модуля — засеять фиксированные рестораны (upsert)
  async onModuleInit() {
    await this.seedRestaurants();
    this.logger.log(
      `[Market Profile] profileSeed=${this.marketProfileSeed}, runSeed=${this.marketRunSeed ?? 'none'}, sharedScope=${this.sharedMarketSeed}`,
    );
    if (!this.marketRunSeed) {
      this.logger.warn(
        'MARKET_RUN_SEED is not set. Shared Redis market state will be reused across restarts while MARKET_PROFILE_SEED stays the same.',
      );
    }

    // Запуск фонового генератора (для Docker-воркеров)
    if (process.env.AUTO_GENERATE === 'true') {
      this.startAutoGeneration();
    }
  }

  private startAutoGeneration() {
    this.autoGenerationBatchSize = parseInt(
      process.env.AUTO_GENERATE_BATCH_SIZE || '50',
      10,
    );
    this.autoGenerationIntervalMs = parseInt(
      process.env.AUTO_GENERATE_INTERVAL || '5000',
      10,
    );
    this.logger.log(
      `[Beast Mode] Запуск автоматической генерации: ${this.autoGenerationBatchSize} заказов каждые ${this.autoGenerationIntervalMs}мс`,
    );
    this.scheduleNextAutoGeneration(0);
  }

  private scheduleNextAutoGeneration(delayMs: number) {
    if (this.autoGenerationTimer) {
      clearTimeout(this.autoGenerationTimer);
    }

    this.autoGenerationTimer = setTimeout(async () => {
      if (this.isGenerating) {
        this.scheduleNextAutoGeneration(this.autoGenerationIntervalMs);
        return;
      }

      if (this.queuedDbBatches >= this.maxQueuedDbBatches) {
        this.logger.warn(
          `⏸ [Авто-Воркер] Пауза генерации: DB queue=${this.queuedDbBatches}, лимит=${this.maxQueuedDbBatches}`,
        );
        this.scheduleNextAutoGeneration(this.autoGenerationIntervalMs);
        return;
      }

      this.isGenerating = true;
      try {
        await this.generateOrders(this.autoGenerationBatchSize);
        this.logger.log(
          `✅ [Авто-Воркер] Сгенерировано и сохранено ${this.autoGenerationBatchSize} заказов.`,
        );
      } catch (err) {
        this.logger.error('❌ Ошибка в автоматической генерации', err);
      } finally {
        this.isGenerating = false;
        this.scheduleNextAutoGeneration(this.autoGenerationIntervalMs);
      }
    }, delayMs);
  }

  private async seedRestaurants() {
    const existingCount = await this.prisma.restaurant.count();
    if (existingCount >= restaurants.length) {
      // База уже заполнена — только загружаем кэш
      this.dbRestaurantsCache = await this.prisma.restaurant.findMany();
      this.hydrateRestaurantCityCache(this.dbRestaurantsCache);
      this.logger.log(
        `Кэш ресторанов загружен (${this.dbRestaurantsCache.length} шт.)`,
      );
      return;
    }

    this.logger.log('Засеивание фиксированных ресторанов...');
    for (const r of restaurants) {
      await this.prisma.restaurant.upsert({
        where: { id: r.id },
        update: {
          brandName: r.brandName,
          legalEntity: r.legalEntity,
          address: r.address,
          inn: r.inn,
          kpp: r.kpp,
          vatPercent: r.vatPercent,
          start: r.start,
          end: r.end,
          timeZone: r.timeZone,
        },
        create: {
          id: r.id,
          brandName: r.brandName,
          legalEntity: r.legalEntity,
          address: r.address,
          inn: r.inn,
          kpp: r.kpp,
          vatPercent: r.vatPercent,
          start: r.start,
          end: r.end,
          timeZone: r.timeZone,
        },
      });
    }
    this.logger.log(`Засеяно ${restaurants.length} ресторанов`);

    // Загружаем рестораны из БД в кэш для генерации заказов
    this.dbRestaurantsCache = await this.prisma.restaurant.findMany();
    this.hydrateRestaurantCityCache(this.dbRestaurantsCache);
    this.logger.log(
      `Загружено ${this.dbRestaurantsCache.length} ресторанов в кэш`,
    );
  }

  private hydrateRestaurantCityCache(
    restaurantsFromDb: Array<{ id: number; address: string }>,
  ) {
    this.restaurantCityById = new Map(
      restaurantsFromDb.map((restaurant) => [
        restaurant.id,
        restaurant.address.split(',')[0].trim(),
      ]),
    );
  }

  async generateOrders(count: number): Promise<any[]> {
    const startedAt = Date.now();
    this.generationBatchCounter += 1;
    this.logger.log(
      `🛠 [Воркер] Начинаю подготовку ${count} заказов (параллельно)...`,
    );

    await this.syncGenerationProfileSeed();
    const quotaResult = buildStatusPlan({
      count,
      quotaProfile: this.getStatusQuotaProfile(),
      deliveredQuotaCarry: this.deliveredQuotaCarry,
      deliveringQuotaCarry: this.deliveringQuotaCarry,
      roll: Math.random,
    });
    this.deliveredQuotaCarry = quotaResult.deliveredQuotaCarry;
    this.deliveringQuotaCarry = quotaResult.deliveringQuotaCarry;
    const plannedStatuses = quotaResult.statuses;
    let newOrders = await mapWithConcurrency(
      plannedStatuses,
      Math.min(plannedStatuses.length, this.orderGenerationConcurrency),
      (plannedStatus) => this.generateSingleOrder(plannedStatus),
    );

    newOrders = newOrders.filter((order) => order !== null);

    if (newOrders.length === 0) {
      this.logger.warn(
        '⚠️ [Воркер] Ни один из заказов не сгенерирован (вероятно, кончились лимиты API).',
      );
      return [];
    }

    this.savedOrders.push(...newOrders);
    if (this.savedOrders.length > DataVitrineService.MAX_IN_MEMORY) {
      this.savedOrders = this.savedOrders.slice(
        -DataVitrineService.MAX_IN_MEMORY,
      );
    }

    this.enqueueDbWrite(newOrders);

    this.logger.log(
      `⚙️ [Воркер] Батч ${newOrders.length}/${count} завершен за ${Date.now() - startedAt}мс`,
    );
    return newOrders;
  }

  private enqueueDbWrite(orders: any[]) {
    this.queuedDbBatches += 1;

    this.dbWriteQueue = this.dbWriteQueue
      .then(async () => {
        this.isDbWriteActive = true;
        this.logger.log(
          `📤 [Воркер] Фоновая запись ${orders.length} заказов в БД. Очередь: ${this.queuedDbBatches}`,
        );
        await this.saveOrdersToDb(orders);
        this.logger.log(
          `✅ [Воркер] Фоновая запись ${orders.length} заказов завершена.`,
        );
      })
      .catch((err) => {
        this.logger.error('❌ Ошибка фоновой записи в БД', err);
      })
      .finally(() => {
        this.queuedDbBatches = Math.max(0, this.queuedDbBatches - 1);
        this.isDbWriteActive = this.queuedDbBatches > 0;
      });
  }

  // Получить вообще все сохраненные заказы (из памяти)
  getAllOrders(): any[] {
    return this.savedOrders;
  }

  // Получить заказы из БД с пагинацией и поиском
  async getOrdersPaginated(
    page: number,
    limit: number,
    search?: string,
    statusFilter?: string,
    paymentFilter?: string,
  ) {
    const skip = (page - 1) * limit;

    // Формируем условия поиска и фильтрации
    const AND: any[] = [];

    if (search) {
      AND.push({
        OR: [
          { status: { contains: search, mode: 'insensitive' } },
          { customer: { fullName: { contains: search, mode: 'insensitive' } } },
          { customer: { phone: { contains: search, mode: 'insensitive' } } },
          { customer: { email: { contains: search, mode: 'insensitive' } } },
          {
            restaurant: {
              brandName: { contains: search, mode: 'insensitive' },
            },
          },
          { courier: { name: { contains: search, mode: 'insensitive' } } },
        ],
      });
    }

    if (statusFilter) {
      AND.push({ status: statusFilter });
    }

    if (paymentFilter) {
      AND.push({ paymentMethod: paymentFilter });
    }

    const where: any = AND.length > 0 ? { AND } : {};

    // Оптимизация: select только полей, которые реально отображаются во фронтенде
    const selectFields = {
      id: true,
      orderDate: true,
      status: true,
      grandTotal: true,
      paymentMethod: true,
      customer: {
        select: {
          fullName: true,
          phone: true,
        },
      },
      restaurant: {
        select: {
          brandName: true,
          address: true,
          inn: true,
          kpp: true,
        },
      },
      orderItems: {
        select: {
          id: true, // только для подсчёта количества
        },
      },
    };

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: selectFields,
        skip,
        take: limit,
        orderBy: { id: 'desc' },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // Добавить свой заказ вручную
  addOrder(order: any): any {
    const savedOrder = {
      ...order,
      createdAt: order.createdAt || new Date().toISOString(),
      updatedAt: order.updatedAt || new Date().toISOString(),
    };
    this.savedOrders.push(savedOrder);
    return savedOrder;
  }

  private generateDishName(): string {
    const adj = this.randomChoice(dishAdjectives);

    // С шансом 20% это десерт, со своим шансом на прилагательное
    if (Math.random() < 0.2) {
      const dessert = this.randomChoice(desserts);
      return Math.random() > 0.5 ? `${adj} ${dessert.toLowerCase()}` : dessert;
    }

    const noun = this.randomChoice(dishNouns);
    return `${adj} ${noun.toLowerCase()}`;
  }

  private async generateSingleOrder(status: OrderStatus) {
    // Предварительно считаем суммы
    const itemsCount = this.randomInt(1, 7);
    let subtotal = 0;

    // Генерируем товары для заказа без лишних промежуточных массивов
    const items = new Array(itemsCount);
    for (let index = 0; index < itemsCount; index += 1) {
      const price = this.randomMoney(100, 1500);
      const qty = this.randomInt(1, 7);
      subtotal += price * qty;

      items[index] = {
        name: this.generateDishName(),
        quantity: qty,
        pricePerUnit: price,
        specialInstructions: this.randomChoice(SPECIAL_INSTRUCTIONS),
        category: this.randomChoice(dishCategories),
      };
    }

    const taxAmount = parseFloat((subtotal * 0.2).toFixed(2));
    const deliveryFee = this.randomChoice(DELIVERY_FEE_OPTIONS);
    const serviceFee = this.randomChoice(SERVICE_FEE_OPTIONS);
    const discountAmount = this.randomChoice([
      0,
      0,
      100,
      200,
      50,
      parseFloat((subtotal * 0.1).toFixed(2)),
    ]);
    const grandTotal = parseFloat(
      (
        subtotal +
        taxAmount +
        deliveryFee +
        serviceFee -
        discountAmount
      ).toFixed(2),
    );

    // Выбираем случайный ресторан из базы (с реальными id)
    const selectedRestaurant = this.randomChoice(this.dbRestaurantsCache);
    const runtimeProfile = this.getRestaurantRuntimeProfile(
      selectedRestaurant.id,
    );
    const restaurantCity =
      this.restaurantCityById.get(selectedRestaurant.id) ??
      selectedRestaurant.address.split(',')[0].trim();

    const shouldUseRestaurantCity = shouldMatchRestaurantCity(
      status,
      Math.random(),
    );
    const city = shouldUseRestaurantCity
      ? restaurantCity
      : faker.location.city();
    const street = faker.location.street();
    const building = `${this.randomInt(1, 150)}/${this.randomInt(1, 10)}`;

    // Получаем координаты и таймзону по адресу через Geoapify API
    const geoData = await this.geocodingService.getGeoDataForAddress(
      city,
      street,
      building,
    );
    if (!geoData) {
      // Геокодер не смог (кончился лимит API) возвращаем null, чтобы заказ отменился
      return null;
    }

    // Генерируем дату заказа
    const orderDateObj = faker.date.recent();

    // orderDate в случайном формате
    const orderDate = this.formatOrderDate(orderDateObj);

    // createdAt = orderDate + пару секунд (попадание записи в БД)
    const createdAt = new Date(
      orderDateObj.getTime() + this.randomInt(1, 5) * 1000,
    ).toISOString();

    // updatedAt = orderDate + случайный отрезок. Задержка зависит от текущего
    // временного состояния ресторана, а не от вечного фиксированного отпечатка.
    const hoursOffset = this.randomChoice(
      getDelayHoursChoices(runtimeProfile.lateness),
    );
    const minutesOffset =
      hoursOffset === 0
        ? this.randomChoice(getZeroDelayMinuteChoices(runtimeProfile.lateness))
        : this.randomInt(0, 59);
    const updatedAt = new Date(
      orderDateObj.getTime() +
        hoursOffset * 60 * 60 * 1000 +
        minutesOffset * 60 * 1000,
    ).toISOString();

    const orderOptions = {
      numberOfCutlery: this.randomInt(0, 5),
      requiresContactlessDelivery: faker.datatype.boolean(),
      isEcoFriendlyPackaging: faker.datatype.boolean(),
    };

    // Review: только при статусе «Доставлен», с 20% шансом всё равно null
    let review: any = null;
    if (status === 'Доставлен' && Math.random() > 0.2) {
      const delayHours = hoursOffset + minutesOffset / 60;
      const { rating } = buildReviewRating({
        quality: runtimeProfile.quality,
        delayHours,
        itemsCount: items.length,
        requiresContactlessDelivery: orderOptions.requiresContactlessDelivery,
        isEcoFriendlyPackaging: orderOptions.isEcoFriendlyPackaging,
        randomChoice: this.randomChoice,
        randomFloat: Math.random,
      });
      const comment = this.randomChoice(
        rating >= 3 ? positiveReviews : negativeReviews,
      );
      review = { rating, comment };
    }

    // ---------------------------------------------------------
    // Делается ПОСЛЕ всех расчетов, чтобы не сломать математику
    // ---------------------------------------------------------

    // Применяем порчу к товарам
    const spoiledItems = items.map((item) => ({
      ...item,
      quantity: this.spoilQuantity(item.quantity) as number,
      pricePerUnit: this.spoilMoney(item.pricePerUnit) as number,
    }));

    // Применяем порчу к финансам
    const spoiledFinancialSummary = {
      subtotal: this.spoilMoney(parseFloat(subtotal.toFixed(2))) as number,
      taxAmount: this.spoilMoney(taxAmount) as number,
      deliveryFee: this.spoilMoney(deliveryFee) as number,
      serviceFee: this.spoilMoney(serviceFee) as number,
      discountAmount: this.spoilMoney(discountAmount) as number,
      grandTotal: this.spoilMoney(grandTotal) as number,
      paymentMethod: this.randomChoice(PAYMENT_METHODS),
    };

    return {
      orderDate,
      currency: 'RUB',
      customer: {
        fullName:
          Math.random() < 0.7
            ? this.randomChoice(customerNames)
            : faker.person.fullName(),
        phone: this.randomChoice([
          `+7-${this.randomDigits(3)}-${this.randomDigits(3)}-${this.randomDigits(2)}-${this.randomDigits(2)}`,
          `8${this.randomDigits(10)}`,
          `+7${this.randomDigits(10)}`,
        ]),
        email: faker.internet.email(),
        deliveryAddress: {
          city,
          street,
          building,
          apartment: this.randomInt(1, 500).toString(),
          entrance: this.randomInt(1, 15).toString(),
          floor: this.randomInt(1, 30),
          intercom: `${this.randomInt(1, 500)}#`,
          postalCode: faker.location.zipCode('######'),
          coordinates: {
            lat: this.jitterCoordinate(
              parseFloat(geoData.lat),
              0.027,
            ).toString(),
            lon: this.jitterCoordinate(
              parseFloat(geoData.lon),
              0.048,
            ).toString(),
          },
          deliveryTimeZone: geoData.timezone,
        },
      },
      restaurant: {
        id: selectedRestaurant.id,
        brandName: selectedRestaurant.brandName,
        address: selectedRestaurant.address,
        inn: selectedRestaurant.inn,
        kpp: selectedRestaurant.kpp,
      },
      orderContent: {
        items: spoiledItems,
        options: orderOptions,
      },
      courier: {
        name:
          Math.random() < 0.7
            ? this.randomChoice(courierNames)
            : faker.person.firstName(),
        transportType: this.randomChoice(TRANSPORT_TYPES),
        currentLocation: {
          lat: faker.location.latitude(),
          lon: faker.location.longitude(),
        },
        phone: `+7${this.randomDigits(10)}`,
        estimatedArrival: this.generateEstimatedArrival(),
      },
      financialSummary: spoiledFinancialSummary,
      status,
      review,
      createdAt,
      updatedAt,
    };
  }

  private randomChoice<T>(choices: readonly T[]): T {
    const randomIndex = Math.floor(Math.random() * choices.length);
    return choices[randomIndex];
  }

  private randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private randomMoney(min: number, max: number): number {
    return Math.round((min + Math.random() * (max - min)) * 100) / 100;
  }

  private randomDigits(length: number): string {
    let result = '';

    for (let index = 0; index < length; index += 1) {
      result += this.randomInt(0, 9).toString();
    }

    return result;
  }

  private randomFloat(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  private formatOrderDate(date: Date): string | number {
    const formatRoll = Math.random();

    if (formatRoll < 0.34) {
      return date.toISOString();
    }

    if (formatRoll < 0.67) {
      return Math.floor(date.getTime() / 1000);
    }

    return `${this.padTwoDigits(date.getDate())}.${this.padTwoDigits(date.getMonth() + 1)}.${date.getFullYear()}`;
  }

  private generateEstimatedArrival(): string {
    const arrivalDate = new Date(
      Date.now() + this.randomInt(5, 120) * 60 * 1000,
    );
    const hours = arrivalDate.getHours();
    const minutes = arrivalDate.getMinutes();

    if (Math.random() < 0.5) {
      const meridiem = hours >= 12 ? 'PM' : 'AM';
      const twelveHour = hours % 12 || 12;
      return `${this.padTwoDigits(twelveHour)}:${this.padTwoDigits(minutes)} ${meridiem}`;
    }

    return `${this.padTwoDigits(hours)}:${this.padTwoDigits(minutes)}`;
  }

  private padTwoDigits(value: number): string {
    return value.toString().padStart(2, '0');
  }

  private spoilMoney(amount: number): string | number {
    let result: string | number = amount;

    if (Math.random() < 0.02) {
      result = result.toString().replace('.', ',');
    }

    if (Math.random() < 0.02) {
      result = `${result} ${this.randomChoice(MONEY_SUFFIXES)}`;
    }

    return result;
  }

  private spoilQuantity(qty: number): string | number {
    if (Math.random() < 0.02) {
      return `${qty} шт.`;
    }

    return qty;
  }

  private getRestaurantRuntimeProfile(
    restaurantId: number,
  ): RestaurantRuntimeProfile {
    const seasonKey = this.getCurrentRestaurantSeasonKey();
    let profile = this.restaurantRuntimeProfiles.get(restaurantId);

    if (!profile || profile.seasonKey !== seasonKey) {
      const createRandomFns = this.createSeededRandomFns(
        `${seasonKey}|restaurant:${restaurantId}|create`,
      );
      profile = createRestaurantRuntimeProfile({
        seasonKey,
        restaurantId,
        marketQualityBias: this.marketQualityBias,
        marketLatenessBias: this.marketLatenessBias,
        scheduleAnchorBatch: this.currentSeasonStartedAtBatch,
        randomFloat: createRandomFns.randomFloat,
        randomInt: createRandomFns.randomInt,
      });
    }

    while (this.currentGlobalBatchNumber >= profile.nextRefreshBatch) {
      const refreshAnchorBatch = profile.nextRefreshBatch;
      const refreshRandomFns = this.createSeededRandomFns(
        `${seasonKey}|restaurant:${restaurantId}|refresh|${refreshAnchorBatch}`,
      );
      profile = refreshRestaurantRuntimeProfile({
        profile,
        marketQualityBias: this.marketQualityBias,
        marketLatenessBias: this.marketLatenessBias,
        scheduleAnchorBatch: refreshAnchorBatch,
        randomFloat: refreshRandomFns.randomFloat,
        randomInt: refreshRandomFns.randomInt,
      });
    }

    this.restaurantRuntimeProfiles.set(restaurantId, profile);
    return profile;
  }

  private getCurrentRestaurantSeasonKey(): string {
    return `${this.sharedMarketSeed}|${this.activeGenerationProfileSeed ?? 'season-0'}`;
  }

  private getStatusQuotaProfile(): StatusQuotaProfile {
    const quotaRandomFns = this.createSeededRandomFns(
      `${this.getCurrentRestaurantSeasonKey()}|status|${this.currentGlobalBatchNumber}`,
    );
    const result = buildStatusQuotaProfile({
      existingProfile: this.statusQuotaProfile,
      generationBatchCounter: this.currentGlobalBatchNumber,
      marketDeliveredRateBias: this.marketDeliveredRateBias,
      marketDeliveringRateBias: this.marketDeliveringRateBias,
      marketQualityBias: this.marketQualityBias,
      marketLatenessBias: this.marketLatenessBias,
      randomFloat: quotaRandomFns.randomFloat,
      randomInt: quotaRandomFns.randomInt,
    });
    this.statusQuotaProfile = result.profile;

    if (result.refreshed) {
      this.logger.log(
        `[Status Quota] delivered=${(result.profile.deliveredRate * 100).toFixed(2)}%, delivering=${(result.profile.deliveringRate * 100).toFixed(2)}%, new=${(result.profile.newShare * 100).toFixed(1)}%, cooking=${(result.profile.cookingShare * 100).toFixed(1)}%, handed=${(result.profile.handedOffShare * 100).toFixed(1)}%, cancelled=${(result.profile.cancelledShare * 100).toFixed(1)}% until batch ${result.profile.nextRefreshBatch - 1}`,
      );
    }

    return this.statusQuotaProfile;
  }

  private async syncGenerationProfileSeed(): Promise<string> {
    const previousSeasonKey = this.activeGenerationProfileSeed;
    const batchContext = await this.sharedMarketStateService.beginBatch(
      this.sharedMarketSeed,
    );

    this.currentGlobalBatchNumber = batchContext.globalBatchNumber;
    this.applySharedSeasonState(batchContext.seasonState);

    if (previousSeasonKey !== this.activeGenerationProfileSeed) {
      this.restaurantRuntimeProfiles.clear();
      this.statusQuotaProfile = null;
      this.logger.log(
        `[Market Season] ${this.activeGenerationProfileSeed} from shared state at global batch ${this.currentGlobalBatchNumber} (qualityBias=${this.marketQualityBias.toFixed(2)}, latenessBias=${this.marketLatenessBias.toFixed(2)}, deliveredBias=${(this.marketDeliveredRateBias * 100).toFixed(2)}pp, deliveringBias=${(this.marketDeliveringRateBias * 100).toFixed(2)}pp)`,
      );
    }

    return this.activeGenerationProfileSeed!;
  }

  private applySharedSeasonState(seasonState: SharedMarketSeasonState): void {
    this.activeGenerationProfileSeed = seasonState.seasonKey;
    this.currentSeasonStartedAtBatch = seasonState.startedAtGlobalBatch;
    this.marketQualityBias = seasonState.marketQualityBias;
    this.marketLatenessBias = seasonState.marketLatenessBias;
    this.marketDeliveredRateBias = seasonState.marketDeliveredRateBias;
    this.marketDeliveringRateBias = seasonState.marketDeliveringRateBias;
  }

  private createSeededRandomFns(seed: string): {
    randomFloat: (min: number, max: number) => number;
    randomInt: (min: number, max: number) => number;
  } {
    const random = createDeterministicRandom(seed);

    return {
      randomFloat: (min: number, max: number) => random.nextFloat(min, max),
      randomInt: (min: number, max: number) => random.nextInt(min, max),
    };
  }

  /** Смещает координату на случайную величину ±maxOffset (~2-3 км) */
  private jitterCoordinate(value: number, maxOffset: number): number {
    const offset = (Math.random() * 2 - 1) * maxOffset;
    return parseFloat((value + offset).toFixed(6));
  }

  // ─────────────────────────────────────────────────────
  // Запись сгенерированных заказов в PostgreSQL
  // ─────────────────────────────────────────────────────
  private async saveOrdersToDb(orders: any[]): Promise<void> {
    try {
      // Для сложных связанных таблиц $transaction за 5 секунд успевает редко (даже 50 штук).
      // Так как это моки, нам не нужна ACID транзакция на весь батч, пишем порциями:
      await eachInChunks(orders, this.dbWriteChunkSize, async (order) => {
        await this.prisma.order.create({
          data: buildOrderCreateData(order),
        });
      });
    } catch (err) {
      this.logger.error(
        'Ошибка батчевой записи заказов в БД, пробуем поштучно...',
        err,
      );
      // Fallback: если хоть один запрос упал, идем поштучно чтобы не терять весь батч
      for (const order of orders) {
        try {
          await this.prisma.order.create({
            data: buildOrderCreateData(order),
          });
        } catch (singleErr) {
          this.logger.error(`Ошибка записи заказа`, singleErr);
        }
      }
    }
  }
}
