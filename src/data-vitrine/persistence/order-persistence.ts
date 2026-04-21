import { Prisma } from '@prisma/client';

export function buildOrderCreateData(order: any): Prisma.OrderCreateInput {
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
        requiresContactlessDelivery:
          order.orderContent.options.requiresContactlessDelivery,
        isEcoFriendlyPackaging:
          order.orderContent.options.isEcoFriendlyPackaging,
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
