import { eachInChunks, mapWithConcurrency } from './async-batch';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('async-batch', () => {
  it('maps items with bounded concurrency while preserving order', async () => {
    let active = 0;
    let peak = 0;

    const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await delay(5);
      active -= 1;
      return value * 10;
    });

    expect(result).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('processes chunk workers batch by batch', async () => {
    let active = 0;
    let peak = 0;
    const processed: number[] = [];

    await eachInChunks([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await delay(5);
      processed.push(value);
      active -= 1;
    });

    expect(peak).toBeLessThanOrEqual(2);
    expect(processed.sort((left, right) => left - right)).toEqual([1, 2, 3, 4, 5]);
  });
});
