import { buildMarketSeedScope } from './market-scope';

describe('market-scope', () => {
  it('uses only market profile seed when run seed is absent', () => {
    expect(
      buildMarketSeedScope({
        marketProfileSeed: 'core-market',
      }),
    ).toEqual({
      marketProfileSeed: 'core-market',
      marketRunSeed: null,
      sharedStateSeed: 'core-market',
    });
  });

  it('separates shared state by run seed when it is provided', () => {
    expect(
      buildMarketSeedScope({
        marketProfileSeed: 'core-market',
        marketRunSeed: 'run-a',
      }),
    ).toEqual({
      marketProfileSeed: 'core-market',
      marketRunSeed: 'run-a',
      sharedStateSeed: 'core-market|run:run-a',
    });
  });

  it('trims both seeds before composing the shared scope', () => {
    expect(
      buildMarketSeedScope({
        marketProfileSeed: '  core-market  ',
        marketRunSeed: '  run-a  ',
      }),
    ).toEqual({
      marketProfileSeed: 'core-market',
      marketRunSeed: 'run-a',
      sharedStateSeed: 'core-market|run:run-a',
    });
  });
});
