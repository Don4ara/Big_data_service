import { createDeterministicRandom } from './deterministic-random';

describe('deterministic-random', () => {
  it('replays the same sequence for the same seed', () => {
    const first = createDeterministicRandom('seed-1');
    const second = createDeterministicRandom('seed-1');

    expect([
      first.nextFloat(-1, 1),
      first.nextInt(1, 10),
      first.nextFloat(0, 100),
      first.nextInt(5, 5),
    ]).toEqual([
      second.nextFloat(-1, 1),
      second.nextInt(1, 10),
      second.nextFloat(0, 100),
      second.nextInt(5, 5),
    ]);
  });

  it('changes the sequence when seed changes', () => {
    const first = createDeterministicRandom('seed-1');
    const second = createDeterministicRandom('seed-2');

    expect(first.nextFloat(0, 1)).not.toBe(second.nextFloat(0, 1));
  });

  it('keeps generated values inside requested bounds', () => {
    const random = createDeterministicRandom('seed-3');

    for (let index = 0; index < 50; index += 1) {
      const floatValue = random.nextFloat(-0.12, 0.12);
      const intValue = random.nextInt(6, 12);

      expect(floatValue).toBeGreaterThanOrEqual(-0.12);
      expect(floatValue).toBeLessThanOrEqual(0.12);
      expect(intValue).toBeGreaterThanOrEqual(6);
      expect(intValue).toBeLessThanOrEqual(12);
    }
  });
});
