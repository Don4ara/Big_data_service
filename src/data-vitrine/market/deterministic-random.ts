function hashString(value: string): number {
  let hash = 0;

  for (const char of value) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0);
    hash |= 0;
  }

  return Math.abs(hash);
}

function hashToUnit(value: string): number {
  return (hashString(value) % 10000) / 9999;
}

export function createDeterministicRandom(seed: string) {
  let cursor = 0;

  const nextUnit = () => {
    const unit = hashToUnit(`${seed}|${cursor}`);
    cursor += 1;
    return unit;
  };

  return {
    nextUnit,
    nextFloat(min: number, max: number): number {
      return min + nextUnit() * (max - min);
    },
    nextInt(min: number, max: number): number {
      const normalizedMin = Math.ceil(min);
      const normalizedMax = Math.floor(max);
      const span = normalizedMax - normalizedMin + 1;

      if (span <= 1) {
        return normalizedMin;
      }

      return normalizedMin + Math.floor(nextUnit() * span);
    },
  };
}
