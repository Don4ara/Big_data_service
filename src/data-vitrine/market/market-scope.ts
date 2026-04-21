export type MarketSeedScope = {
  marketProfileSeed: string;
  marketRunSeed: string | null;
  sharedStateSeed: string;
};

function normalizeSeed(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function buildMarketSeedScope(input: {
  marketProfileSeed?: string | null;
  marketRunSeed?: string | null;
  fallbackProfileSeed?: string;
}): MarketSeedScope {
  const marketProfileSeed =
    normalizeSeed(input.marketProfileSeed) ??
    input.fallbackProfileSeed ??
    new Date().toISOString().slice(0, 16);
  const marketRunSeed = normalizeSeed(input.marketRunSeed);

  return {
    marketProfileSeed,
    marketRunSeed,
    sharedStateSeed: marketRunSeed
      ? `${marketProfileSeed}|run:${marketRunSeed}`
      : marketProfileSeed,
  };
}
