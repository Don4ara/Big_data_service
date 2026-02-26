import { Injectable } from '@nestjs/common';
import { fakerRU as faker } from '@faker-js/faker';
import { v4 as uuidv4 } from 'uuid';
import {
  dishAdjectives,
  dishNouns,
  desserts,
  dishCategories,
  restBrands,
  restLegals,
  positiveReviews,
  negativeReviews,
  customerNames,
  courierNames,
} from './mock-dictionaries';
import { GeocodingService } from './geocoding.service';

@Injectable()
export class DataVitrineService {
  // Хранилище сгенерированных и добавленных вручную заказов (в памяти)
  private savedOrders: any[] = [];

  constructor(private readonly geocodingService: GeocodingService) { }

  async generateOrders(count: number): Promise<any[]> {
    const newOrders: any[] = [];
    for (let i = 0; i < count; i++) {
      const order = await this.generateSingleOrder();
      newOrders.push(order);
      this.savedOrders.push(order); // Сохраняем в память
    }
    return newOrders;
  }

  // Получить вообще все сохраненные заказы
  getAllOrders(): any[] {
    return this.savedOrders;
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

    let review: any = null;
    if (status === 'Доставлен') {
      const isPositive = Math.random() > 0.3; // 70% positive rate
      const rating = isPositive
        ? faker.number.int({ min: 4, max: 5 })
        : faker.number.int({ min: 1, max: 3 });
      const comment = this.randomChoice(
        isPositive ? positiveReviews : negativeReviews,
      );
      review = { rating, comment };
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
    const updatedAt = new Date(
      orderDateObj.getTime() +
      faker.number.int({ min: 0, max: 5 }) * 60 * 60 * 1000 + // часы
      faker.number.int({ min: 0, max: 59 }) * 60 * 1000,       // минуты
    ).toISOString();

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
        restaurantId: faker.string.numeric({ length: 4, allowLeadingZeros: false }),
        brandName: this.randomChoice(restBrands),
        legalEntity: this.randomChoice(restLegals),
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
        items: items,
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
      financialSummary: {
        subtotal: parseFloat(subtotal.toFixed(2)),
        taxAmount: taxAmount,
        deliveryFee: deliveryFee,
        serviceFee: serviceFee,
        discountAmount: discountAmount,
        grandTotal: grandTotal,
        paymentMethod: this.randomChoice([
          'CARD_ONLINE',
          'CASH',
          'APPLE_PAY',
          'GOOGLE_PAY',
          'SBP',
        ]),
      },
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
}
