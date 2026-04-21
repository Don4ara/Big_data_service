import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  createSharedMarketSeasonState,
  isSharedMarketSeasonExpired,
  SharedMarketSeasonState,
} from './market-season';

type MarketBatchContext = {
  globalBatchNumber: number;
  seasonState: SharedMarketSeasonState;
};

@Injectable()
export class SharedMarketStateService {
  private readonly logger = new Logger(SharedMarketStateService.name);
  private readonly sharedStateEnabled: boolean;
  private readonly redis: Redis | null;
  private localBatchCounter = 0;
  private localSeasonState: SharedMarketSeasonState | null = null;

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    this.sharedStateEnabled =
      this.configService.get<string>('SHARED_MARKET_STATE_ENABLED') !== 'false';

    this.redis =
      this.sharedStateEnabled && redisUrl
        ? new Redis(redisUrl, {
            lazyConnect: false,
            maxRetriesPerRequest: 1,
            enableReadyCheck: false,
          })
        : null;

    if (this.redis) {
      this.redis.on('error', (error) => {
        this.logger.warn(
          `Shared market state unavailable: ${error.message}. Falling back to local state.`,
        );
      });
    }

    this.logger.log(
      `Shared market state ${this.redis ? 'enabled' : 'local-only'}`,
    );
  }

  async beginBatch(marketProfileSeed: string): Promise<MarketBatchContext> {
    if (!this.redis) {
      return this.beginLocalBatch(marketProfileSeed);
    }

    try {
      const batchCounterKey = this.getBatchCounterKey(marketProfileSeed);
      const globalBatchNumber = await this.redis.incr(batchCounterKey);
      let seasonState = await this.readSeasonState(marketProfileSeed);

      if (
        !seasonState ||
        isSharedMarketSeasonExpired(seasonState, globalBatchNumber)
      ) {
        seasonState = await this.rotateSharedSeason(
          marketProfileSeed,
          globalBatchNumber,
          seasonState,
        );
      }

      return {
        globalBatchNumber,
        seasonState,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Shared market state read failed: ${message}. Falling back to local state.`,
      );
      return this.beginLocalBatch(marketProfileSeed);
    }
  }

  private beginLocalBatch(marketProfileSeed: string): MarketBatchContext {
    this.localBatchCounter += 1;

    if (
      !this.localSeasonState ||
      isSharedMarketSeasonExpired(this.localSeasonState, this.localBatchCounter)
    ) {
      const nextSeasonCounter = (this.localSeasonState?.seasonCounter ?? 0) + 1;
      this.localSeasonState = createSharedMarketSeasonState({
        marketProfileSeed,
        seasonCounter: nextSeasonCounter,
        startedAtGlobalBatch: this.localBatchCounter,
      });
    }

    return {
      globalBatchNumber: this.localBatchCounter,
      seasonState: this.localSeasonState,
    };
  }

  private async rotateSharedSeason(
    marketProfileSeed: string,
    globalBatchNumber: number,
    previousSeasonState: SharedMarketSeasonState | null,
  ): Promise<SharedMarketSeasonState> {
    if (!this.redis) {
      const nextSeasonCounter = (previousSeasonState?.seasonCounter ?? 0) + 1;
      return createSharedMarketSeasonState({
        marketProfileSeed,
        seasonCounter: nextSeasonCounter,
        startedAtGlobalBatch: globalBatchNumber,
      });
    }

    const lockKey = this.getRotationLockKey(marketProfileSeed);
    const lockValue = `${process.pid}:${Date.now()}`;
    const lockAcquired = await this.redis.set(
      lockKey,
      lockValue,
      'PX',
      5000,
      'NX',
    );

    if (lockAcquired) {
      const currentState = await this.readSeasonState(marketProfileSeed);

      if (
        currentState &&
        !isSharedMarketSeasonExpired(currentState, globalBatchNumber)
      ) {
        return currentState;
      }

      const nextSeasonCounter =
        (currentState?.seasonCounter ??
          previousSeasonState?.seasonCounter ??
          0) + 1;
      const nextState = createSharedMarketSeasonState({
        marketProfileSeed,
        seasonCounter: nextSeasonCounter,
        startedAtGlobalBatch: globalBatchNumber,
      });

      await this.writeSeasonState(marketProfileSeed, nextState);
      return nextState;
    }

    await this.delay(60);
    const sharedState = await this.readSeasonState(marketProfileSeed);

    if (sharedState) {
      return sharedState;
    }

    const fallbackSeasonCounter = (previousSeasonState?.seasonCounter ?? 0) + 1;
    return createSharedMarketSeasonState({
      marketProfileSeed,
      seasonCounter: fallbackSeasonCounter,
      startedAtGlobalBatch: globalBatchNumber,
    });
  }

  private async readSeasonState(
    marketProfileSeed: string,
  ): Promise<SharedMarketSeasonState | null> {
    if (!this.redis) {
      return null;
    }

    const payload = await this.redis.get(
      this.getSeasonStateKey(marketProfileSeed),
    );
    return payload ? (JSON.parse(payload) as SharedMarketSeasonState) : null;
  }

  private async writeSeasonState(
    marketProfileSeed: string,
    seasonState: SharedMarketSeasonState,
  ): Promise<void> {
    if (!this.redis) {
      return;
    }

    await this.redis.set(
      this.getSeasonStateKey(marketProfileSeed),
      JSON.stringify(seasonState),
    );
  }

  private getBatchCounterKey(marketProfileSeed: string): string {
    return `market:batch:${marketProfileSeed}`;
  }

  private getSeasonStateKey(marketProfileSeed: string): string {
    return `market:season:${marketProfileSeed}`;
  }

  private getRotationLockKey(marketProfileSeed: string): string {
    return `market:season:lock:${marketProfileSeed}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
