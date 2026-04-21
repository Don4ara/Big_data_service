export async function mapWithConcurrency<T, TResult>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  const safeConcurrency = Math.max(1, concurrency);
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(safeConcurrency, items.length) }, () =>
      worker(),
    ),
  );

  return results;
}

export async function eachInChunks<T>(
  items: readonly T[],
  chunkSize: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const safeChunkSize = Math.max(1, chunkSize);

  for (
    let startIndex = 0;
    startIndex < items.length;
    startIndex += safeChunkSize
  ) {
    const chunk = items.slice(startIndex, startIndex + safeChunkSize);

    await Promise.all(
      chunk.map((item, offset) => worker(item, startIndex + offset)),
    );
  }
}
