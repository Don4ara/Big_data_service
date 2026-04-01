import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { restaurants } from '../mock-dictionaries';

@Injectable()
export class OrderDbService {
  private readonly logger = new Logger(OrderDbService.name);
  public dbRestaurantsCache: any[] = [];

  constructor(private readonly prisma: PrismaService) {}

  async seedRestaurants() {
    this.logger.log('Синхронизация фиксированных ресторанов...');
    const existingRestaurants = await this.prisma.restaurant.findMany();
    const existingByFingerprint = new Map(
      existingRestaurants.map((restaurant) => [
        this.buildRestaurantFingerprint(restaurant),
        restaurant,
      ]),
    );

    for (const restaurant of restaurants) {
      const fingerprint = this.buildRestaurantFingerprint(restaurant);
      const existingRestaurant = existingByFingerprint.get(fingerprint);
      const data = {
        brandName: restaurant.brandName,
        legalEntity: restaurant.legalEntity,
        address: restaurant.address,
        inn: restaurant.inn,
        kpp: restaurant.kpp,
        vatPercent: restaurant.vatPercent,
        start: restaurant.start,
        end: restaurant.end,
        timeZone: restaurant.timeZone,
      };

      if (existingRestaurant) {
        await this.prisma.restaurant.update({
          where: { id: existingRestaurant.id },
          data,
        });
      } else {
        await this.prisma.restaurant.create({ data });
      }
    }

    this.dbRestaurantsCache = await this.prisma.restaurant.findMany();
    this.logger.log(`Синхронизировано ${this.dbRestaurantsCache.length} ресторанов`);
  }

  private buildRestaurantFingerprint(restaurant: any): string {
    return [
      restaurant.brandName,
      restaurant.address,
      restaurant.inn,
      restaurant.kpp,
    ].join('|');
  }

  async getOrdersPaginated(page: number, limit: number, search?: string, statusFilter?: string, paymentFilter?: string) {
    const skip = (page - 1) * limit;
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

    if (statusFilter) AND.push({ status: statusFilter });
    if (paymentFilter) AND.push({ paymentMethod: paymentFilter });

    const where: any = AND.length > 0 ? { AND } : {};

    const selectFields = {
      id: true,
      orderDate: true,
      status: true,
      grandTotal: true,
      paymentMethod: true,
      customer: { select: { fullName: true, phone: true } },
      restaurant: { select: { brandName: true, address: true, inn: true, kpp: true } },
      orderItems: { select: { id: true } },
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

  async saveOrdersToDb(orders: any[]): Promise<void> {
    const operations = orders.map((order) =>
      this.prisma.order.create({
        data: this.buildOrderDataProxy(order),
      })
    );

    try {
      const chunkSize = 20;
      for (let i = 0; i < operations.length; i += chunkSize) {
        await Promise.all(operations.slice(i, i + chunkSize));
      }
    } catch (err) {
      this.logger.error('Ошибка батчевой записи заказов в БД, пробуем поштучно...', err);
      for (const order of orders) {
        try {
          await this.prisma.order.create({
            data: this.buildOrderDataProxy(order),
          });
        } catch (singleErr) {
          this.logger.error(`Ошибка записи одного заказа`, singleErr);
        }
      }
    }
  }

  private buildOrderDataProxy(order: any): any {
    return {
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
      restaurant: { connect: { id: order.restaurant.id } },
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
    };
  }
}
