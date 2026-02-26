import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

interface GeoResult {
    lat: string;
    lon: string;
    timezone: string;
}

@Injectable()
export class GeocodingService {
    private readonly logger = new Logger(GeocodingService.name);
    private readonly API_KEY: string;
    private readonly BASE_URL = 'https://us1.locationiq.com/v1';

    // Кэш: город → { lat, lon, timezone }
    private cache = new Map<string, GeoResult>();

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
    ) {
        this.API_KEY = this.configService.get<string>('LOCATIONIQ_API_KEY')!;
    }

    /**
     * По адресу (город, улица, дом) получает координаты и таймзону.
     * Кэширует результат по городу.
     */
    async getGeoDataForAddress(
        city: string,
        street: string,
        building: string,
    ): Promise<GeoResult> {
        // Проверяем кэш по городу
        if (this.cache.has(city)) {
            return this.cache.get(city)!;
        }

        try {
            // 1. Геокодирование: адрес → координаты
            const query = `Russia, ${city}, ${street} ${building}`;
            const coords = await this.geocodeAddress(query);

            // Задержка 600мс для rate limit (2 req/sec)
            await this.delay(600);

            // 2. Координаты → таймзона
            const timezone = await this.getTimezone(coords.lat, coords.lon);

            const result: GeoResult = {
                lat: coords.lat,
                lon: coords.lon,
                timezone,
            };

            // Сохраняем в кэш
            this.cache.set(city, result);
            this.logger.log(`Geocoded: ${city} → ${coords.lat}, ${coords.lon} → ${timezone}`);

            return result;
        } catch (error) {
            this.logger.warn(`Geocoding failed for "${city}": ${error.message}. Using fallback.`);
            // Фоллбэк: возвращаем Москву
            return {
                lat: '55.7558',
                lon: '37.6173',
                timezone: 'Europe/Samara',
            };
        }
    }

    /**
     * Геокодирование: строка адреса → { lat, lon }
     */
    private async geocodeAddress(query: string): Promise<{ lat: string; lon: string }> {
        const url = `${this.BASE_URL}/search`;
        const response = await firstValueFrom(
            this.httpService.get(url, {
                params: {
                    key: this.API_KEY,
                    q: query,
                    format: 'json',
                    limit: 1,
                },
            }),
        );

        const data = response.data;
        if (!data || !Array.isArray(data) || data.length === 0) {
            throw new Error(`No results for query: ${query}`);
        }

        return {
            lat: data[0].lat,
            lon: data[0].lon,
        };
    }

    /**
     * Координаты → IANA таймзона (напр. "Europe/Moscow")
     */
    private async getTimezone(lat: string, lon: string): Promise<string> {
        const url = `${this.BASE_URL}/timezone`;
        const response = await firstValueFrom(
            this.httpService.get(url, {
                params: {
                    key: this.API_KEY,
                    lat,
                    lon,
                },
            }),
        );

        const data = response.data;
        if (!data?.timezone?.name) {
            throw new Error(`No timezone data for coords: ${lat}, ${lon}`);
        }

        return data.timezone.name;
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
