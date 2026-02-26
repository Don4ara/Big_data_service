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
    private readonly BASE_URL = 'https://api.geoapify.com/v1/geocode/search';

    // Кэш: город → Promise (чтобы не дублировать параллельные запросы) или готовый GeoResult
    private cache = new Map<string, Promise<GeoResult> | GeoResult>();

    // Глобальная очередь для всех HTTP-запросов к API (строго 1 запрос раз в 600мс)
    private requestChain: Promise<any> = Promise.resolve();

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
    ) {
        this.API_KEY = this.configService.get<string>('GEOAPIFY_API_KEY')!;
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
        // Если уже есть в кэше (готовый результат или процесс загрузки)
        if (this.cache.has(city)) {
            return this.cache.get(city)!;
        }

        // Запускаем процесс и сразу сохраняем Promise в кэш
        const fetchPromise = this._fetchGeoDataAndCache(city, street, building);
        this.cache.set(city, fetchPromise);
        return fetchPromise;
    }

    private async _fetchGeoDataAndCache(city: string, street: string, building: string): Promise<GeoResult> {
        try {
            const query = `Russia, ${city}, ${street} ${building}`;
            const result = await this.executeWithRateLimit(() => this.geocodeAddress(query));

            // Сохраняем в кэш уже готовый результат
            this.cache.set(city, result);
            this.logger.log(`Geocoded (Geoapify): ${city} → ${result.lat}, ${result.lon} → ${result.timezone}`);

            return result;
        } catch (error) {
            this.logger.warn(`Geocoding failed for "${city}": ${error.message}. Using fallback.`);
            // Фоллбэк: возвращаем Самару
            const fallback: GeoResult = { lat: '55.7558', lon: '37.6173', timezone: 'Europe/Samara' };
            // Сохраняем фоллбэк в кэш, чтобы больше не спамить API этим городом
            this.cache.set(city, fallback);
            return fallback;
        }
    }

    /**
     * Выполняет функцию строго с задержкой относительно предыдущих запросов
     */
    private executeWithRateLimit<T>(fn: () => Promise<T>): Promise<T> {
        const next = this.requestChain.then(async () => {
            await this.delay(600); // Строго 600мс между любыми запросами
            return fn();
        });
        // Ловим ошибки в цепочке, чтобы очередь не сломалась навсегда
        this.requestChain = next.catch(() => { });
        return next;
    }

    /**
     * Геокодирование через Geoapify: строка адреса → { lat, lon, timezone }
     */
    private async geocodeAddress(query: string): Promise<GeoResult> {
        const response = await firstValueFrom(
            this.httpService.get(this.BASE_URL, {
                params: {
                    apiKey: this.API_KEY,
                    text: query,
                    format: 'json',
                    limit: 1,
                },
            }),
        );

        const data = response.data;
        if (!data || !data.results || data.results.length === 0) {
            throw new Error(`No results for query: ${query}`);
        }

        const feature = data.results[0];

        // Geoapify может не вернуть timezone в некоторых случаях
        if (!feature.timezone || !feature.timezone.name) {
            this.logger.warn(`No timezone data returned for query: ${query}, defaulting to Europe/Moscow`);
            return {
                lat: feature.lat.toString(),
                lon: feature.lon.toString(),
                timezone: 'Europe/Moscow',
            };
        }

        return {
            lat: feature.lat.toString(),
            lon: feature.lon.toString(),
            timezone: feature.timezone.name, // e.g. "Europe/Moscow"
        };
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
