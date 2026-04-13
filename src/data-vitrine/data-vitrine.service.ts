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
} from './mock-dictionaries';
import { GeocodingService } from './geocoding.service';
import { PrismaService } from '../prisma.service';
import {
  buildReviewRating,
  getRestaurantDelayHoursChoices,
  getRestaurantZeroDelayMinuteChoices,
} from './review-rating';

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
  private readonly maxQueuedDbBatches = parseInt(process.env.MAX_QUEUED_DB_BATCHES || '4', 10);

  constructor(
    private readonly geocodingService: GeocodingService,
    private readonly prisma: PrismaService,
  ) { }

  // При старте модуля — засеять фиксированные рестораны (upsert)
  async onModuleInit() {
    await this.seedRestaurants();

    // Запуск фонового генератора (для Docker-воркеров)
    if (process.env.AUTO_GENERATE === 'true') {
      this.startAutoGeneration();
    }
  }

  private startAutoGeneration() {
    this.autoGenerationBatchSize = parseInt(process.env.AUTO_GENERATE_BATCH_SIZE || '50', 10);
    this.autoGenerationIntervalMs = parseInt(process.env.AUTO_GENERATE_INTERVAL || '5000', 10);
    this.logger.log(`[Beast Mode] Запуск автоматической генерации: ${this.autoGenerationBatchSize} заказов каждые ${this.autoGenerationIntervalMs}мс`);
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
        this.logger.warn(`⏸ [Авто-Воркер] Пауза генерации: DB queue=${this.queuedDbBatches}, лимит=${this.maxQueuedDbBatches}`);
        this.scheduleNextAutoGeneration(this.autoGenerationIntervalMs);
        return;
      }

      this.isGenerating = true;
      try {
        await this.generateOrders(this.autoGenerationBatchSize);
        this.logger.log(`✅ [Авто-Воркер] Сгенерировано и сохранено ${this.autoGenerationBatchSize} заказов.`);
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
      this.logger.log(`Кэш ресторанов загружен (${this.dbRestaurantsCache.length} шт.)`);
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
    this.logger.log(`Загружено ${this.dbRestaurantsCache.length} ресторанов в кэш`);
  }


  async generateOrders(count: number): Promise<any[]> {
    const startedAt = Date.now();
    this.logger.log(`🛠 [Воркер] Начинаю подготовку ${count} заказов (параллельно)...`);

    const promises = Array.from({ length: count }).map(() => this.generateSingleOrder());
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

    this.enqueueDbWrite(newOrders);

    this.logger.log(`⚙️ [Воркер] Батч ${newOrders.length}/${count} завершен за ${Date.now() - startedAt}мс`);
    return newOrders;
  }

  private enqueueDbWrite(orders: any[]) {
    this.queuedDbBatches += 1;

    this.dbWriteQueue = this.dbWriteQueue
      .then(async () => {
        this.isDbWriteActive = true;
        this.logger.log(`📤 [Воркер] Фоновая запись ${orders.length} заказов в БД. Очередь: ${this.queuedDbBatches}`);
        await this.saveOrdersToDb(orders);
        this.logger.log(`✅ [Воркер] Фоновая запись ${orders.length} заказов завершена.`);
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
  async getOrdersPaginated(page: number, limit: number, search?: string, statusFilter?: string, paymentFilter?: string) {
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
          { restaurant: { brandName: { contains: search, mode: 'insensitive' } } },
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

  private async generateSingleOrder() {
    // Предварительно считаем суммы
    const itemsCount = faker.number.int({ min: 1, max: 7 });
    let subtotal = 0;

    // Генерируем товары для заказа
    const items = Array.from({ length: itemsCount }).map(() => {
      const price = parseFloat(
        faker.finance.amount({ min: 100, max: 1500, dec: 2 }),
      );
      const qty = faker.number.int({ min: 1, max: 7 });
      subtotal += price * qty;

      return {
        name: this.generateDishName(),
        quantity: qty,
        pricePerUnit: price,
        specialInstructions: this.randomChoice([
          'Без лука, пожалуйста',
          'Поострее',
          'Не класть салфетки',
          'Меньше льда',
          'Соус отдельно',
          'Приборы на 3 персоны',
          null,
          null,
          null,
        ]),
        category: this.randomChoice(dishCategories),
      };
    });

    const taxAmount = parseFloat((subtotal * 0.2).toFixed(2));
    const deliveryFee = this.randomChoice([100, 150, 200, 0, 300, 49]);
    const serviceFee = this.randomChoice([29, 39, 49, 0]);
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

    // Генерируем адрес покупателя
    const city = faker.location.city();
    const street = faker.location.street();
    const building = `${faker.number.int({ min: 1, max: 150 })}/${faker.number.int({ min: 1, max: 10 })}`;

    // Получаем координаты и таймзону по адресу через Geoapify API
    const geoData = await this.geocodingService.getGeoDataForAddress(city, street, building);
    if (!geoData) {
      // Геокодер не смог (кончился лимит API) возвращаем null, чтобы заказ отменился
      return null;
    }

    // Выбираем случайный ресторан из базы (с реальными id)
    const selectedRestaurant = this.randomChoice(this.dbRestaurantsCache);

    // Извлекаем город ресторана из адреса (первая часть до запятой)
    const restaurantCity = selectedRestaurant.address.split(',')[0].trim();
    const citiesMatch = restaurantCity.toLowerCase() === city.toLowerCase();

    // Определяем статус с учётом совпадения городов
    let status: string;
    if (citiesMatch) {
      // Города совпадают — любой статус
      status = this.randomChoice([
        'Новый',
        'Готовится',
        'Передан курьеру',
        'Доставляется',
        'Доставлен',
        'Отменен',
      ]);
    } else {
      // Города НЕ совпадают — «Доставлен»/«Доставляется» только как ошибка (3%)
      if (Math.random() < 0.03) {
        status = this.randomChoice(['Доставлен', 'Доставляется']);
      } else {
        status = this.randomChoice([
          'Новый',
          'Готовится',
          'Передан курьеру',
          'Отменен',
        ]);
      }
    }

    // Генерируем дату заказа
    const orderDateObj = faker.date.recent();

    // orderDate в случайном формате
    const orderDate = this.randomChoice([
      orderDateObj.toISOString(),                              // ISO 8601
      Math.floor(orderDateObj.getTime() / 1000),               // Unix timestamp
      orderDateObj.toLocaleDateString('ru-RU'),                 // dd.mm.yyyy
    ]);

    // createdAt = orderDate + пару секунд (попадание записи в БД)
    const createdAt = new Date(
      orderDateObj.getTime() + faker.number.int({ min: 1, max: 5 }) * 1000,
    ).toISOString();

    // updatedAt = orderDate + случайный отрезок, а профиль ресторана меняется по временным окнам
    const restaurantKey = this.buildRestaurantFingerprint(selectedRestaurant);
    const restaurantProfileKey = `${restaurantKey}|${orderDateObj.toISOString().slice(0, 10)}`;
    const hoursOffset = this.randomChoice(getRestaurantDelayHoursChoices(restaurantProfileKey));
    const minutesOffset = hoursOffset === 0
      ? this.randomChoice(getRestaurantZeroDelayMinuteChoices(restaurantProfileKey))
      : faker.number.int({ min: 0, max: 59 });
    const updatedAt = new Date(
      orderDateObj.getTime() +
      hoursOffset * 60 * 60 * 1000 +
      minutesOffset * 60 * 1000,
    ).toISOString();

    const orderOptions = {
      numberOfCutlery: faker.number.int({ min: 0, max: 5 }),
      requiresContactlessDelivery: faker.datatype.boolean(),
      isEcoFriendlyPackaging: faker.datatype.boolean(),
    };

    // Review: только при статусе «Доставлен», с 20% шансом всё равно null
    let review: any = null;
    if (status === 'Доставлен' && Math.random() > 0.2) {
      const delayHours = hoursOffset + minutesOffset / 60;
      const { rating } = buildReviewRating({
        restaurantKey: restaurantProfileKey,
        delayHours,
        itemsCount: items.length,
        requiresContactlessDelivery: orderOptions.requiresContactlessDelivery,
        isEcoFriendlyPackaging: orderOptions.isEcoFriendlyPackaging,
        randomChoice: this.randomChoice.bind(this),
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

    // Хелпер для порчи денег (шанс 2% на каждую ошибку)
    const spoilMoney = (amount: number): string | number => {
      let result: string | number = amount;
      if (Math.random() < 0.02) {
        result = result.toString().replace('.', ',');
      }
      if (Math.random() < 0.02) {
        const suffix = this.randomChoice(['руб.', 'р.', 'рублей', '₽']);
        result = `${result} ${suffix}`;
      }
      return result;
    };

    // Хелпер для порчи количества (шанс 3%)
    const spoilQuantity = (qty: number): string | number => {
      if (Math.random() < 0.02) {
        return `${qty} шт.`;
      }
      return qty;
    };

    // Применяем порчу к товарам
    const spoiledItems = items.map(item => ({
      ...item,
      quantity: spoilQuantity(item.quantity) as number,
      pricePerUnit: spoilMoney(item.pricePerUnit) as number,
    }));

    // Применяем порчу к финансам
    const spoiledFinancialSummary = {
      subtotal: spoilMoney(parseFloat(subtotal.toFixed(2))) as number,
      taxAmount: spoilMoney(taxAmount) as number,
      deliveryFee: spoilMoney(deliveryFee) as number,
      serviceFee: spoilMoney(serviceFee) as number,
      discountAmount: spoilMoney(discountAmount) as number,
      grandTotal: spoilMoney(grandTotal) as number,
      paymentMethod: this.randomChoice([
        'CARD_ONLINE',
        'CASH',
        'APPLE_PAY',
        'GOOGLE_PAY',
        'SBP',
      ]),
    };



    return {
      orderDate,
      currency: 'RUB',
      customer: {
        fullName: Math.random() < 0.7 ? this.randomChoice(customerNames) : faker.person.fullName(),
        phone: this.randomChoice([
          `+7-${faker.string.numeric(3)}-${faker.string.numeric(3)}-${faker.string.numeric(2)}-${faker.string.numeric(2)}`,
          `8${faker.string.numeric(10)}`,
          `+7${faker.string.numeric(10)}`,
        ]),
        email: faker.internet.email(),
        deliveryAddress: {
          city,
          street,
          building,
          apartment: faker.number.int({ min: 1, max: 500 }).toString(),
          entrance: faker.number.int({ min: 1, max: 15 }).toString(),
          floor: faker.number.int({ min: 1, max: 30 }),
          intercom: `${faker.number.int({ min: 1, max: 500 })}#`,
          postalCode: faker.location.zipCode('######'),
          coordinates: {
            lat: this.jitterCoordinate(parseFloat(geoData.lat), 0.027).toString(),
            lon: this.jitterCoordinate(parseFloat(geoData.lon), 0.048).toString(),
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
        name: Math.random() < 0.7 ? this.randomChoice(courierNames) : faker.person.firstName(),
        transportType: this.randomChoice([
          'bicycle',
          'car',
          'walking',
          'scooter',
        ]),
        currentLocation: {
          lat: faker.location.latitude(),
          lon: faker.location.longitude(),
        },
        phone: `+7${faker.string.numeric(10)}`,
        estimatedArrival: this.randomChoice([
          faker.date.soon().toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          faker.date.soon().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          }),
          faker.date.soon().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }),
        ]),
      },
      financialSummary: spoiledFinancialSummary,
      status,
      review,
      createdAt,
      updatedAt,
    };
  }

  private randomChoice<T>(choices: T[]): T {
    const randomIndex = Math.floor(Math.random() * choices.length);
    return choices[randomIndex];
  }

  private buildRestaurantFingerprint(restaurant: {
    brandName: string;
    address: string;
    inn: string;
    kpp: string;
  }): string {
    return [
      restaurant.brandName,
      restaurant.address,
      restaurant.inn,
      restaurant.kpp,
    ].join('|');
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
    const operations = orders.map((order) =>
      this.prisma.order.create({
        data: {
          orderDate: String(order.orderDate),
          currency: order.currency,
          status: order.status,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,

          // Финансовые поля (теперь прямо в orders)
          subtotal: String(order.financialSummary.subtotal),
          taxAmount: String(order.financialSummary.taxAmount),
          deliveryFee: String(order.financialSummary.deliveryFee),
          serviceFee: String(order.financialSummary.serviceFee),
          discountAmount: String(order.financialSummary.discountAmount),
          grandTotal: String(order.financialSummary.grandTotal),
          paymentMethod: order.financialSummary.paymentMethod,

          // Связь с рестораном (через id)
          restaurant: {
            connect: {
              id: order.restaurant.id,
            },
          },

          // Создание покупателя
          customer: {
            create: {
              fullName: order.customer.fullName,
              phone: order.customer.phone,
              email: order.customer.email,
              deliveryAddress: {
                create: {
                  city: order.customer.deliveryAddress.city,
                  street: order.customer.deliveryAddress.street,
                  building: order.customer.deliveryAddress.building,
                  apartment: order.customer.deliveryAddress.apartment,
                  entrance: order.customer.deliveryAddress.entrance,
                  floor: order.customer.deliveryAddress.floor,
                  intercom: order.customer.deliveryAddress.intercom,
                  postalCode: order.customer.deliveryAddress.postalCode,
                  deliveryTimeZone: order.customer.deliveryAddress.deliveryTimeZone,
                  coordinates: {
                    create: {
                      lat: String(order.customer.deliveryAddress.coordinates.lat),
                      lon: String(order.customer.deliveryAddress.coordinates.lon),
                    },
                  },
                },
              },
            },
          },

          orderItems: {
            create: order.orderContent.items.map((item: any) => ({
              name: item.name,
              quantity: String(item.quantity),
              pricePerUnit: String(item.pricePerUnit),
              category: item.category,
              specialInstructions: item.specialInstructions ?? null,
            })),
          },

          orderOptions: {
            create: {
              numberOfCutlery: order.orderContent.options.numberOfCutlery,
              requiresContactlessDelivery: order.orderContent.options.requiresContactlessDelivery,
              isEcoFriendlyPackaging: order.orderContent.options.isEcoFriendlyPackaging,
            },
          },

          courier: {
            create: {
              name: order.courier.name,
              transportType: order.courier.transportType,
              phone: order.courier.phone,
              estimatedArrival: order.courier.estimatedArrival,
              location: {
                create: {
                  lat: parseFloat(order.courier.currentLocation.lat),
                  lon: parseFloat(order.courier.currentLocation.lon),
                },
              },
            },
          },

          ...(order.review
            ? {
              review: {
                create: {
                  rating: order.review.rating,
                  comment: order.review.comment,
                },
              },
            }
            : {}),
        },
      }),
    );

    try {
      // Для сложных связанных таблиц $transaction за 5 секунд успевает редко (даже 50 штук).
      // Так как это моки, нам не нужна ACID транзакция на весь батч, пишем порциями:
      const chunkSize = 20;
      for (let i = 0; i < operations.length; i += chunkSize) {
        await Promise.all(operations.slice(i, i + chunkSize));
      }
    } catch (err) {
      this.logger.error('Ошибка батчевой записи заказов в БД, пробуем поштучно...', err);
      // Fallback: если хоть один запрос упал, идем поштучно чтобы не терять весь батч
      for (const order of orders) {
        try {
          await this.prisma.order.create({
            data: {
              orderDate: String(order.orderDate),
              currency: order.currency,
              status: order.status,
              createdAt: order.createdAt,
              updatedAt: order.updatedAt,

              subtotal: String(order.financialSummary.subtotal),
              taxAmount: String(order.financialSummary.taxAmount),
              deliveryFee: String(order.financialSummary.deliveryFee),
              serviceFee: String(order.financialSummary.serviceFee),
              discountAmount: String(order.financialSummary.discountAmount),
              grandTotal: String(order.financialSummary.grandTotal),
              paymentMethod: order.financialSummary.paymentMethod,

              restaurant: {
                connect: {
                  id: order.restaurant.id,
                },
              },

              customer: {
                create: {
                  fullName: order.customer.fullName,
                  phone: order.customer.phone,
                  email: order.customer.email,
                  deliveryAddress: {
                    create: {
                      city: order.customer.deliveryAddress.city,
                      street: order.customer.deliveryAddress.street,
                      building: order.customer.deliveryAddress.building,
                      apartment: order.customer.deliveryAddress.apartment,
                      entrance: order.customer.deliveryAddress.entrance,
                      floor: order.customer.deliveryAddress.floor,
                      intercom: order.customer.deliveryAddress.intercom,
                      postalCode: order.customer.deliveryAddress.postalCode,
                      deliveryTimeZone: order.customer.deliveryAddress.deliveryTimeZone,
                      coordinates: {
                        create: {
                          lat: String(order.customer.deliveryAddress.coordinates.lat),
                          lon: String(order.customer.deliveryAddress.coordinates.lon),
                        },
                      },
                    },
                  },
                },
              },
              orderItems: {
                create: order.orderContent.items.map((item: any) => ({
                  name: item.name,
                  quantity: String(item.quantity),
                  pricePerUnit: String(item.pricePerUnit),
                  category: item.category,
                  specialInstructions: item.specialInstructions ?? null,
                })),
              },
              orderOptions: {
                create: {
                  numberOfCutlery: order.orderContent.options.numberOfCutlery,
                  requiresContactlessDelivery: order.orderContent.options.requiresContactlessDelivery,
                  isEcoFriendlyPackaging: order.orderContent.options.isEcoFriendlyPackaging,
                },
              },
              courier: {
                create: {
                  name: order.courier.name,
                  transportType: order.courier.transportType,
                  phone: order.courier.phone,
                  estimatedArrival: order.courier.estimatedArrival,
                  location: {
                    create: {
                      lat: parseFloat(order.courier.currentLocation.lat),
                      lon: parseFloat(order.courier.currentLocation.lon),
                    },
                  },
                },
              },
              ...(order.review
                ? {
                  review: {
                    create: {
                      rating: order.review.rating,
                      comment: order.review.comment,
                    },
                  },
                }
                : {}),
            },
          });
        } catch (singleErr) {
          this.logger.error(`Ошибка записи заказа`, singleErr);
        }
      }
    }
  }
}
