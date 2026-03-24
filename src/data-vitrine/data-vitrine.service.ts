import { Injectable, Logger } from '@nestjs/common';
import { fakerRU as faker } from '@faker-js/faker';
import { v4 as uuidv4 } from 'uuid';
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

@Injectable()
export class DataVitrineService {
  private readonly logger = new Logger(DataVitrineService.name);
  // Хранилище сгенерированных и добавленных вручную заказов (в памяти)
  // Ограничено MAX_IN_MEMORY записями для защиты от утечки памяти
  private savedOrders: any[] = [];
  private static readonly MAX_IN_MEMORY = 500;

  constructor(
    private readonly geocodingService: GeocodingService,
    private readonly prisma: PrismaService,
  ) { }

  async generateOrders(count: number): Promise<any[]> {
    const newOrders: any[] = [];
    for (let i = 0; i < count; i++) {
      const order = await this.generateSingleOrder();
      newOrders.push(order);
    }

    // Сохраняем в in-memory буфер (с ограничением)
    this.savedOrders.push(...newOrders);
    if (this.savedOrders.length > DataVitrineService.MAX_IN_MEMORY) {
      this.savedOrders = this.savedOrders.slice(-DataVitrineService.MAX_IN_MEMORY);
    }

    // Сохраняем в БД асинхронно (не блокируем отдачу данных)
    this.saveOrdersToDb(newOrders).catch((err) =>
      this.logger.error('Ошибка записи в БД', err),
    );

    return newOrders;
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
          { orderId: { contains: search, mode: 'insensitive' } },
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
      AND.push({ financialSummary: { paymentMethod: paymentFilter } });
    }

    const where: any = AND.length > 0 ? { AND } : {};

    // Оптимизация: select только полей, которые реально отображаются во фронтенде
    // вместо include всех связанных моделей целиком
    const selectFields = {
      id: true,
      orderId: true,
      orderDate: true,
      status: true,
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
          taxInfo: {
            select: {
              inn: true,
              kpp: true,
            },
          },
        },
      },
      orderItems: {
        select: {
          id: true, // только для подсчёта количества
        },
      },
      financialSummary: {
        select: {
          grandTotal: true,
          paymentMethod: true,
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
      orderId:
        order.orderId ||
        faker.string.numeric({ length: 8, allowLeadingZeros: false }),
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
    // Предварительно считаем суммы для financialSummary
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
        productId: faker.string.numeric({ length: 6, allowLeadingZeros: false }),
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

    // Получаем координаты и таймзону по адресу через LocationIQ API
    const geoData = await this.geocodingService.getGeoDataForAddress(city, street, building);

    // 2% шанс что город ресторана не совпадает с городом покупателя
    const isCityMismatch = Math.random() < 0.02;
    let restaurantCity = city;
    if (isCityMismatch) {
      // Генерируем другой город, отличный от покупателя
      do {
        restaurantCity = faker.location.city();
      } while (restaurantCity === city);
    }

    // Определяем статус: при несовпадении городов — 80% «Отменен»
    let status: string;
    if (isCityMismatch) {
      status = Math.random() < 0.8
        ? 'Отменен'
        : this.randomChoice(['Новый', 'Готовится']);
    } else {
      status = this.randomChoice([
        'Новый',
        'Готовится',
        'Передан курьеру',
        'Доставляется',
        'Доставлен',
        'Отменен',
      ]);
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

    // updatedAt = orderDate + случайный отрезок (0–5 часов + минуты)
    const hoursOffset = faker.number.int({ min: 0, max: 5 });
    const minutesOffset = faker.number.int({ min: 0, max: 59 });
    const updatedAt = new Date(
      orderDateObj.getTime() +
      hoursOffset * 60 * 60 * 1000 +
      minutesOffset * 60 * 1000,
    ).toISOString();

    // Review: только при статусе «Доставлен», с 20% шансом всё равно null
    let review: any = null;
    if (status === 'Доставлен' && Math.random() > 0.2) {
      // Базовый рейтинг от 3 до 5 (чаще хорошие оценки)
      const baseRating = faker.number.int({ min: 3, max: 5 });
      // Вычитаем количество часов выполнения доставки, чтобы рейтинг зависел от неё
      // Вычитаем 1 балл за каждые 1-2 часа, чтобы рейтинг не скатывался в 0
      const downgrade = Math.floor(hoursOffset / 2);
      // Рейтинг не может быть меньше 1
      const rating = Math.max(1, baseRating - downgrade);
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
        // Замена точки на запятую
        result = result.toString().replace('.', ',');
      }
      if (Math.random() < 0.02) {
        // Добавление валюты
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
      quantity: spoilQuantity(item.quantity) as number, // хак типов для схемы
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

    // Выбираем случайный ресторан из статичного списка
    const selectedRestaurant = this.randomChoice(restaurants);

    return {
      orderId: faker.string.numeric({ length: 9, allowLeadingZeros: false }),
      orderDate,
      currency: 'RUB',
      customer: {
        customerId: faker.string.numeric({ length: 7, allowLeadingZeros: false }),
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
            lat: geoData.lat,
            lon: geoData.lon,
          },
          deliveryTimeZone: geoData.timezone,
        },
      },
      restaurant: {
        restaurantId: selectedRestaurant.restaurantId,
        brandName: selectedRestaurant.brandName,
        legalEntity: selectedRestaurant.legalEntity,
        address: `${restaurantCity}, ${faker.location.streetAddress()}`,
        taxInfo: {
          inn: faker.string.numeric(10),
          kpp: faker.string.numeric(9),
          vatPercent: 20,
        },
        workingHours: (() => {
          const startHour = faker.number.int({ min: 7, max: 12 });
          const endHour = startHour + 10;
          return {
            start: `${startHour.toString().padStart(2, '0')}:00:00`,
            end: `${endHour.toString().padStart(2, '0')}:00:00`,
            timeZone: geoData.timezone,
          };
        })(),
      },
      orderContent: {
        items: spoiledItems, // используем испорченные товары
        options: {
          numberOfCutlery: faker.number.int({ min: 0, max: 5 }),
          requiresContactlessDelivery: faker.datatype.boolean(),
          isEcoFriendlyPackaging: faker.datatype.boolean(),
        },
      },
      courier: {
        courierId: faker.string.numeric({ length: 5, allowLeadingZeros: false }),
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
          }), // "14:30"
          faker.date.soon().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          }), // "02:30 PM"
          faker.date.soon().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }), // "14:30" 
        ]),
      },
      financialSummary: spoiledFinancialSummary, // используем испорченные финансы
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

  // ─────────────────────────────────────────────────────
  // Запись сгенерированных заказов в PostgreSQL
  // ─────────────────────────────────────────────────────
  private async saveOrdersToDb(orders: any[]): Promise<void> {
    // Оптимизация: батчевая запись через транзакцию вместо отдельных create
    // Снижает количество roundtrip-ов к БД с N до 1
    const operations = orders.map((order) =>
      this.prisma.order.create({
        data: {
          orderId: order.orderId,
          orderDate: String(order.orderDate),
          currency: order.currency,
          status: order.status,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,

          customer: {
            create: {
              customerId: order.customer.customerId,
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

          restaurant: {
            create: {
              restaurantId: order.restaurant.restaurantId,
              brandName: order.restaurant.brandName,
              legalEntity: order.restaurant.legalEntity,
              address: order.restaurant.address,
              taxInfo: {
                create: {
                  inn: order.restaurant.taxInfo.inn,
                  kpp: order.restaurant.taxInfo.kpp,
                  vatPercent: order.restaurant.taxInfo.vatPercent,
                },
              },
              workingHours: {
                create: {
                  start: order.restaurant.workingHours.start,
                  end: order.restaurant.workingHours.end,
                  timeZone: order.restaurant.workingHours.timeZone,
                },
              },
            },
          },

          orderItems: {
            create: order.orderContent.items.map((item: any) => ({
              productId: item.productId,
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
              courierId: order.courier.courierId,
              name: order.courier.name,
              transportType: order.courier.transportType,
              phone: order.courier.phone,
              estimatedArrival: order.courier.estimatedArrival,
              currentLocation: {
                create: {
                  lat: parseFloat(order.courier.currentLocation.lat),
                  lon: parseFloat(order.courier.currentLocation.lon),
                },
              },
            },
          },

          financialSummary: {
            create: {
              subtotal: String(order.financialSummary.subtotal),
              taxAmount: String(order.financialSummary.taxAmount),
              deliveryFee: String(order.financialSummary.deliveryFee),
              serviceFee: String(order.financialSummary.serviceFee),
              discountAmount: String(order.financialSummary.discountAmount),
              grandTotal: String(order.financialSummary.grandTotal),
              paymentMethod: order.financialSummary.paymentMethod,
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
      await this.prisma.$transaction(operations);
    } catch (err) {
      this.logger.error('Ошибка батчевой записи заказов в БД, пробуем поштучно...', err);
      // Fallback: если транзакция упала (например, дубликат orderId) — пишем поштучно
      for (const order of orders) {
        try {
          await this.prisma.order.create({
            data: {
              orderId: order.orderId,
              orderDate: String(order.orderDate),
              currency: order.currency,
              status: order.status,
              createdAt: order.createdAt,
              updatedAt: order.updatedAt,
              customer: {
                create: {
                  customerId: order.customer.customerId,
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
              restaurant: {
                create: {
                  restaurantId: order.restaurant.restaurantId,
                  brandName: order.restaurant.brandName,
                  legalEntity: order.restaurant.legalEntity,
                  address: order.restaurant.address,
                  taxInfo: {
                    create: {
                      inn: order.restaurant.taxInfo.inn,
                      kpp: order.restaurant.taxInfo.kpp,
                      vatPercent: order.restaurant.taxInfo.vatPercent,
                    },
                  },
                  workingHours: {
                    create: {
                      start: order.restaurant.workingHours.start,
                      end: order.restaurant.workingHours.end,
                      timeZone: order.restaurant.workingHours.timeZone,
                    },
                  },
                },
              },
              orderItems: {
                create: order.orderContent.items.map((item: any) => ({
                  productId: item.productId,
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
                  courierId: order.courier.courierId,
                  name: order.courier.name,
                  transportType: order.courier.transportType,
                  phone: order.courier.phone,
                  estimatedArrival: order.courier.estimatedArrival,
                  currentLocation: {
                    create: {
                      lat: parseFloat(order.courier.currentLocation.lat),
                      lon: parseFloat(order.courier.currentLocation.lon),
                    },
                  },
                },
              },
              financialSummary: {
                create: {
                  subtotal: String(order.financialSummary.subtotal),
                  taxAmount: String(order.financialSummary.taxAmount),
                  deliveryFee: String(order.financialSummary.deliveryFee),
                  serviceFee: String(order.financialSummary.serviceFee),
                  discountAmount: String(order.financialSummary.discountAmount),
                  grandTotal: String(order.financialSummary.grandTotal),
                  paymentMethod: order.financialSummary.paymentMethod,
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
          this.logger.error(`Ошибка записи заказа ${order.orderId}`, singleErr);
        }
      }
    }
  }
}
