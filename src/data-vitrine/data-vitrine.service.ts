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

@Injectable()
export class DataVitrineService {
  // Хранилище сгенерированных и добавленных вручную заказов (в памяти)
  private savedOrders: any[] = [];

  generateOrders(count: number): any[] {
    const newOrders: any[] = [];
    for (let i = 0; i < count; i++) {
      const order = this.generateSingleOrder();
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

  private generateSingleOrder() {
    // Предварительно считаем суммы для financialSummary
    const itemsCount = faker.number.int({ min: 1, max: 6 });
    let subtotal = 0;

    // Генерируем товары для заказа
    const items = Array.from({ length: itemsCount }).map(() => {
      const price = parseFloat(
        faker.finance.amount({ min: 100, max: 1500, dec: 2 }),
      );
      const qty = this.randomChoice([1, 2, 3]);
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

    const status = this.randomChoice([
      'Новый',
      'Готовится',
      'Передан курьеру',
      'Доставляется',
      'Доставлен',
      'Отменен',
    ]);

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

    return {
      orderId: faker.string.numeric({ length: 9, allowLeadingZeros: false }),
      orderDate: this.randomChoice([
        faker.date.recent().toISOString(), // ISO 8601
        Math.floor(faker.date.recent().getTime() / 1000), // Unix
        faker.date.recent().toLocaleDateString('ru-RU'), // dd.mm.yyyy
      ]),
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
          city: faker.location.city(),
          street: faker.location.street(),
          building: `${faker.number.int({ min: 1, max: 150 })}/${faker.number.int({ min: 1, max: 10 })}`,
          apartment: faker.number.int({ min: 1, max: 500 }).toString(),
          entrance: faker.number.int({ min: 1, max: 15 }).toString(),
          floor: faker.number.int({ min: 1, max: 30 }),
          intercom: `${faker.number.int({ min: 1, max: 500 })}#`,
          postalCode: faker.location.zipCode('######'),
          deliveryTimeZone: this.randomChoice([
            faker.location.timeZone(), // 'Europe/Moscow', 'Asia/Yekaterinburg' etc
            '+03:00',
            '+05:00',
            '+07:00',
          ]),
        },
      },
      restaurant: {
        restaurantId: faker.string.numeric({ length: 4, allowLeadingZeros: false }),
        brandName: this.randomChoice(restBrands),
        legalEntity: this.randomChoice(restLegals),
        address: `${faker.location.city()}, ${faker.location.streetAddress()}`,
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
            timeZone: this.randomChoice([
              faker.location.timeZone(),
              '+03:00',
              '+05:00',
            ]),
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
      createdAt: faker.date.past().toISOString(),
      updatedAt: faker.date.recent().toISOString(),
    };
  }

  private randomChoice<T>(choices: T[]): T {
    const randomIndex = Math.floor(Math.random() * choices.length);
    return choices[randomIndex];
  }
}
