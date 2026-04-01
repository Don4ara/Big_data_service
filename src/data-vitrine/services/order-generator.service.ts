import { Injectable } from '@nestjs/common';
import { fakerRU as faker } from '@faker-js/faker';
import {
  dishAdjectives,
  dishNouns,
  desserts,
  dishCategories,
  positiveReviews,
  negativeReviews,
  customerNames,
  courierNames,
} from '../mock-dictionaries';
import { GeocodingService } from '../geocoding.service';

@Injectable()
export class OrderGeneratorService {
  constructor(private readonly geocodingService: GeocodingService) {}

  async generateSingleOrder(dbRestaurantsCache: any[]) {
    if (dbRestaurantsCache.length === 0) return null;

    const itemsCount = faker.number.int({ min: 1, max: 7 });
    let subtotal = 0;

    const items = Array.from({ length: itemsCount }).map(() => {
      const price = parseFloat(faker.finance.amount({ min: 100, max: 1500, dec: 2 }));
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
          null, null, null,
        ]),
        category: this.randomChoice(dishCategories),
      };
    });

    const taxAmount = parseFloat((subtotal * 0.2).toFixed(2));
    const deliveryFee = this.randomChoice([100, 150, 200, 0, 300, 49]);
    const serviceFee = this.randomChoice([29, 39, 49, 0]);
    const discountAmount = this.randomChoice([
      0, 0, 100, 200, 50, parseFloat((subtotal * 0.1).toFixed(2)),
    ]);
    const grandTotal = parseFloat(
      (subtotal + taxAmount + deliveryFee + serviceFee - discountAmount).toFixed(2),
    );

    const city = faker.location.city();
    const street = faker.location.street();
    const building = `${faker.number.int({ min: 1, max: 150 })}/${faker.number.int({ min: 1, max: 10 })}`;

    const geoData = await this.geocodingService.getGeoDataForAddress(city, street, building);
    if (!geoData) return null;

    const selectedRestaurant = this.randomChoice(dbRestaurantsCache);
    const restaurantCity = selectedRestaurant.address.split(',')[0].trim();
    const citiesMatch = restaurantCity.toLowerCase() === city.toLowerCase();

    const hoursOffset = faker.number.int({ min: 0, max: 5 });
    const minutesOffset = faker.number.int({ min: 0, max: 59 });
    const totalMinutes = hoursOffset * 60 + minutesOffset;

    let status: string;
    if (!citiesMatch) {
      if (Math.random() < 0.02) {
        status = Math.random() < 0.5 ? 'Доставлен' : 'Доставляется';
      } else {
        status = Math.random() < 0.8 ? 'Отменен' : 'Новый';
      }
    } else {
      if (totalMinutes < 15) {
        status = 'Новый';
      } else if (totalMinutes < 45) {
        const r = Math.random();
        status = r < 0.85 ? 'Готовится' : r < 0.95 ? 'Новый' : 'Отменен';
      } else if (totalMinutes < 75) {
        const r = Math.random();
        status = r < 0.7 ? 'Передан курьеру' : r < 0.9 ? 'Готовится' : 'Отменен';
      } else if (totalMinutes < 120) {
        const r = Math.random();
        status = r < 0.7 ? 'Доставляется' : r < 0.85 ? 'Передан курьеру' : 'Отменен';
      } else {
        const r = Math.random();
        status = r < 0.85 ? 'Доставлен' : r < 0.95 ? 'Отменен' : 'Доставляется';
      }
    }

    const orderDateObj = faker.date.recent();
    const orderDate = this.randomChoice([
      orderDateObj.toISOString(),
      Math.floor(orderDateObj.getTime() / 1000),
      orderDateObj.toLocaleDateString('ru-RU'),
    ]);

    const createdAt = new Date(
      orderDateObj.getTime() + faker.number.int({ min: 1, max: 5 }) * 1000,
    ).toISOString();

    const updatedAt = new Date(
      orderDateObj.getTime() + hoursOffset * 60 * 60 * 1000 + minutesOffset * 60 * 1000,
    ).toISOString();

    let review: any = null;
    if (status === 'Доставлен' && Math.random() > 0.2) {
      const totalDeliveryHours = hoursOffset + minutesOffset / 60;
      const charSum = selectedRestaurant.brandName.split('').reduce((sum: number, char: string) => sum + char.charCodeAt(0), 0);
      const modOptions = [-1.0, -0.5, 0.0, 0.0, 0.5];
      const restaurantQualityModifier = modOptions[(selectedRestaurant.id + charSum) % modOptions.length];

      let rating = 5.0 - Math.floor(totalDeliveryHours) * 0.5 + restaurantQualityModifier;
      if (Math.random() < 0.3) {
        rating += Math.random() < 0.5 ? -0.5 : 0.5;
      }
      rating = Math.max(0.5, Math.min(5.0, Math.round(rating * 2) / 2));

      let comment: string;
      if (rating >= 4.0) {
        comment = this.randomChoice(positiveReviews);
      } else if (rating >= 3.0) {
        comment = this.randomChoice(Math.random() < 0.6 ? positiveReviews : negativeReviews);
      } else {
        comment = this.randomChoice(negativeReviews);
      }
      review = { rating, comment };
    }

    const spoilMoney = (amount: number): string | number => {
      let result: string | number = amount;
      if (Math.random() < 0.02) result = result.toString().replace('.', ',');
      if (Math.random() < 0.02) {
        const suffix = this.randomChoice(['руб.', 'р.', 'рублей', '₽']);
        result = `${result} ${suffix}`;
      }
      return result;
    };

    const spoilQuantity = (qty: number): string | number =>
      Math.random() < 0.02 ? `${qty} шт.` : qty;

    const spoiledItems = items.map(item => ({
      ...item,
      quantity: spoilQuantity(item.quantity) as number,
      pricePerUnit: spoilMoney(item.pricePerUnit) as number,
    }));

    const spoiledFinancialSummary = {
      subtotal: spoilMoney(parseFloat(subtotal.toFixed(2))) as number,
      taxAmount: spoilMoney(taxAmount) as number,
      deliveryFee: spoilMoney(deliveryFee) as number,
      serviceFee: spoilMoney(serviceFee) as number,
      discountAmount: spoilMoney(discountAmount) as number,
      grandTotal: spoilMoney(grandTotal) as number,
      paymentMethod: this.randomChoice([
        'CARD_ONLINE', 'CASH', 'APPLE_PAY', 'GOOGLE_PAY', 'SBP',
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
        options: {
          numberOfCutlery: faker.number.int({ min: 0, max: 5 }),
          requiresContactlessDelivery: faker.datatype.boolean(),
          isEcoFriendlyPackaging: faker.datatype.boolean(),
        },
      },
      courier: {
        name: Math.random() < 0.7 ? this.randomChoice(courierNames) : faker.person.firstName(),
        transportType: this.randomChoice(['bicycle', 'car', 'walking', 'scooter']),
        currentLocation: {
          lat: faker.location.latitude(),
          lon: faker.location.longitude(),
        },
        phone: `+7${faker.string.numeric(10)}`,
        estimatedArrival: this.randomChoice([
          faker.date.soon().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
          faker.date.soon().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
          faker.date.soon().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        ]),
      },
      financialSummary: spoiledFinancialSummary,
      status, review, createdAt, updatedAt,
    };
  }

  private generateDishName(): string {
    const adj = this.randomChoice(dishAdjectives);
    if (Math.random() < 0.2) {
      const dessert = this.randomChoice(desserts);
      return Math.random() > 0.5 ? `${adj} ${dessert.toLowerCase()}` : dessert;
    }
    return `${adj} ${this.randomChoice(dishNouns).toLowerCase()}`;
  }

  private randomChoice<T>(choices: T[]): T {
    return choices[Math.floor(Math.random() * choices.length)];
  }

  private jitterCoordinate(value: number, maxOffset: number): number {
    return parseFloat((value + (Math.random() * 2 - 1) * maxOffset).toFixed(6));
  }
}
