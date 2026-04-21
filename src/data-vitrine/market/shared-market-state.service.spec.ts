import { SharedMarketStateService } from './shared-market-state.service';

class FakeRedis {
  private readonly storage = new Map<string, string>();
  private readonly expiry = new Map<string, number>();
  private now = 0;

  advanceTime(ms: number) {
    this.now += ms;
  }

  private cleanup(key: string) {
    const expiresAt = this.expiry.get(key);

    if (expiresAt && expiresAt <= this.now) {
      this.storage.delete(key);
      this.expiry.delete(key);
    }
  }

  async incr(key: string): Promise<number> {
    this.cleanup(key);
    const nextValue = Number(this.storage.get(key) ?? '0') + 1;
    this.storage.set(key, nextValue.toString());
    return nextValue;
  }

  async get(key: string): Promise<string | null> {
    this.cleanup(key);
    return this.storage.get(key) ?? null;
  }

  async set(key: string, value: string, ...args: Array<string | number>): Promise<'OK' | null> {
    this.cleanup(key);

    if (args.includes('NX') && this.storage.has(key)) {
      return null;
    }

    this.storage.set(key, value);

    const pxIndex = args.indexOf('PX');
    if (pxIndex >= 0 && typeof args[pxIndex + 1] === 'number') {
      this.expiry.set(key, this.now + Number(args[pxIndex + 1]));
    } else {
      this.expiry.delete(key);
    }

    return 'OK';
  }
}

describe('shared-market-state.service', () => {
  function createWorker(fakeRedis: FakeRedis) {
    const service = new SharedMarketStateService({
      get: () => undefined,
    } as any);

    (service as any).redis = fakeRedis;
    return service;
  }

  it('shares the same season state between simulated workers', async () => {
    const fakeRedis = new FakeRedis();
    const workerOne = createWorker(fakeRedis);
    const workerTwo = createWorker(fakeRedis);

    const firstBatch = await workerOne.beginBatch('market-seed');
    const secondBatch = await workerTwo.beginBatch('market-seed');

    expect(firstBatch.globalBatchNumber).toBe(1);
    expect(secondBatch.globalBatchNumber).toBe(2);
    expect(secondBatch.seasonState).toEqual(firstBatch.seasonState);
  });

  it('rotates season once and exposes the same next season to all workers', async () => {
    const fakeRedis = new FakeRedis();
    const workerOne = createWorker(fakeRedis);
    const workerTwo = createWorker(fakeRedis);

    const firstBatch = await workerOne.beginBatch('market-seed');
    const seasonLength = firstBatch.seasonState.seasonLengthBatches;

    for (let index = 1; index < seasonLength; index += 1) {
      await workerOne.beginBatch('market-seed');
    }

    fakeRedis.advanceTime(5001);
    const rotatedByWorkerOne = await workerOne.beginBatch('market-seed');
    const observedByWorkerTwo = await workerTwo.beginBatch('market-seed');

    expect(rotatedByWorkerOne.seasonState.seasonKey).not.toBe(
      firstBatch.seasonState.seasonKey,
    );
    expect(observedByWorkerTwo.seasonState).toEqual(
      rotatedByWorkerOne.seasonState,
    );
  });

  it('keeps market state isolated between different run seeds', async () => {
    const fakeRedis = new FakeRedis();
    const worker = createWorker(fakeRedis);

    const firstRun = await worker.beginBatch('market-seed|run:alpha');
    const secondRun = await worker.beginBatch('market-seed|run:beta');

    expect(firstRun.globalBatchNumber).toBe(1);
    expect(secondRun.globalBatchNumber).toBe(1);
    expect(secondRun.seasonState.seasonKey).toBe(firstRun.seasonState.seasonKey);
    expect(secondRun.seasonState.startedAtGlobalBatch).toBe(1);
  });
});
