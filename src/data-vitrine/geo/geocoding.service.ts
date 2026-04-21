import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import Bottleneck from 'bottleneck';
import Redis from 'ioredis';

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
  private readonly fallback: GeoResult = {
    lat: '55.7558',
    lon: '37.6173',
    timezone: 'Europe/Samara',
  };
  private readonly redisCachePrefix = 'geocode:city:';

  // Кэш: нормализованный город → Promise (чтобы не дублировать параллельные запросы) или готовый GeoResult
  private cache = new Map<string, Promise<GeoResult> | GeoResult>();
  private readonly geocodingConcurrency: number;
  private readonly geocodeTimeoutMs: number;
  private readonly geocodingRetries: number;
  private readonly geocodingMinTimeMs: number;
  private readonly limiter: Bottleneck;
  private geocodeCacheEnabled: boolean;
  private readonly redis: Redis | null;
  private stats = {
    l1Hits: 0,
    l2Hits: 0,
    externalCalls: 0,
    fallbacks: 0,
    retries: 0,
  };

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.API_KEY = this.configService.get<string>('GEOAPIFY_API_KEY')!;
    this.geocodingConcurrency = parseInt(
      this.configService.get<string>('GEOCODING_CONCURRENCY') || '5',
      10,
    );
    this.geocodeTimeoutMs = parseInt(
      this.configService.get<string>('GEOAPIFY_TIMEOUT_MS') || '1500',
      10,
    );
    this.geocodingRetries = parseInt(
      this.configService.get<string>('GEOCODING_RETRIES') || '1',
      10,
    );
    this.geocodingMinTimeMs = parseInt(
      this.configService.get<string>('GEOCODING_MIN_TIME_MS') || '0',
      10,
    );
    this.geocodeCacheEnabled =
      this.configService.get<string>('SHARED_GEOCACHE_ENABLED') === 'true';
    this.limiter = new Bottleneck({
      maxConcurrent: Math.max(1, this.geocodingConcurrency),
      minTime: Math.max(0, this.geocodingMinTimeMs),
    });

    const redisUrl = this.configService.get<string>('REDIS_URL');
    this.redis =
      this.geocodeCacheEnabled && redisUrl
        ? new Redis(redisUrl, {
            lazyConnect: false,
            maxRetriesPerRequest: 1,
            enableReadyCheck: false,
          })
        : null;

    if (this.redis) {
      this.redis.on('error', (err) => {
        this.logger.warn(
          `Redis geocache unavailable: ${err.message}. Shared cache will be disabled.`,
        );
        this.geocodeCacheEnabled = false;
      });
    }

    const backend = this.redis ? 'redis' : 'disabled';
    this.logger.log(
      `Shared geocache ${this.geocodeCacheEnabled ? 'enabled' : 'disabled'} (${backend}), concurrency=${this.geocodingConcurrency}, timeout=${this.geocodeTimeoutMs}ms, retries=${this.geocodingRetries}`,
    );
  }

  /**
   * По адресу (город, улица, дом) получает координаты и таймзону.
   * Кэширует результат по городу.
   */
  async getGeoDataForAddress(
    city: string,
    _street: string,
    _building: string,
  ): Promise<GeoResult> {
    const cityKey = this.normalizeCity(city);

    if (this.cache.has(cityKey)) {
      this.stats.l1Hits += 1;
      return this.cache.get(cityKey)!;
    }

    const fetchPromise = this.fetchGeoDataAndCache(cityKey, city);
    this.cache.set(cityKey, fetchPromise);
    return fetchPromise;
  }

  private normalizeCity(city: string): string {
    return city.trim().toLocaleLowerCase('ru-RU');
  }

  private async fetchGeoDataAndCache(
    cityKey: string,
    city: string,
  ): Promise<GeoResult> {
    const startedAt = Date.now();

    try {
      const cached = await this.readFromSharedCache(cityKey);

      if (cached) {
        const result: GeoResult = {
          lat: cached.lat,
          lon: cached.lon,
          timezone: cached.timezone,
        };
        this.cache.set(cityKey, result);
        this.stats.l2Hits += 1;
        this.logger.debug(`Geo L2 hit: ${city} (${Date.now() - startedAt}ms)`);
        return result;
      }

      const query = `Russia, ${city}`;
      const result = await this.fetchWithRetry(query);

      await this.writeToSharedCache(cityKey, city, result);

      this.cache.set(cityKey, result);
      this.logger.log(
        `Geo external: ${city} → ${result.lat}, ${result.lon} → ${result.timezone} (${Date.now() - startedAt}ms, l1=${this.stats.l1Hits}, l2=${this.stats.l2Hits}, ext=${this.stats.externalCalls}, retry=${this.stats.retries}, fallback=${this.stats.fallbacks})`,
      );

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.stats.fallbacks += 1;
      this.logger.warn(
        `Geocoding failed for "${city}": ${message}. Using fallback.`,
      );
      this.cache.set(cityKey, this.fallback);
      return this.fallback;
    }
  }

  private async readFromSharedCache(cityKey: string) {
    if (!this.geocodeCacheEnabled || !this.redis) {
      return null;
    }

    try {
      const cached = await this.redis.get(`${this.redisCachePrefix}${cityKey}`);
      return cached ? (JSON.parse(cached) as GeoResult) : null;
    } catch (error) {
      this.disableSharedCacheIfUnavailable(error, 'read');
      return null;
    }
  }

  private async writeToSharedCache(
    cityKey: string,
    city: string,
    result: GeoResult,
  ): Promise<void> {
    if (!this.geocodeCacheEnabled || !this.redis) {
      return;
    }

    try {
      await this.redis.set(
        `${this.redisCachePrefix}${cityKey}`,
        JSON.stringify({ city, ...result }),
      );
    } catch (error) {
      this.disableSharedCacheIfUnavailable(error, 'write');
    }
  }

  private disableSharedCacheIfUnavailable(
    error: unknown,
    action: 'read' | 'write',
  ) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('Redis') || message.includes('ECONNREFUSED')) {
      this.geocodeCacheEnabled = false;
      this.logger.warn(
        `Shared geocode cache is unavailable during ${action}; falling back to in-memory cache only.`,
      );
      return;
    }

    throw error;
  }

  private async fetchWithRetry(query: string): Promise<GeoResult> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.geocodingRetries; attempt += 1) {
      try {
        this.stats.externalCalls += 1;
        return await this.limiter.schedule(() => this.geocodeAddress(query));
      } catch (error) {
        lastError = error;
        if (attempt === this.geocodingRetries) {
          break;
        }

        this.stats.retries += 1;
        const delayMs = 150 * (attempt + 1) + Math.floor(Math.random() * 100);
        await this.delay(delayMs);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async geocodeAddress(query: string): Promise<GeoResult> {
    const response = await firstValueFrom(
      this.httpService.get(this.BASE_URL, {
        timeout: this.geocodeTimeoutMs,
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

    if (!feature.timezone || !feature.timezone.name) {
      this.logger.warn(
        `No timezone data returned for query: ${query}, defaulting to Europe/Moscow`,
      );
      return {
        lat: feature.lat.toString(),
        lon: feature.lon.toString(),
        timezone: 'Europe/Moscow',
      };
    }

    return {
      lat: feature.lat.toString(),
      lon: feature.lon.toString(),
      timezone: feature.timezone.name,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
