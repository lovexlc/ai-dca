import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveDefaultBacktestCodes,
  selectBacktestBaseCandles,
} from '../src/components/markets/backtestSidePanelState.js';

test('market detail backtest defaults 513100 to H and 159501 to L', () => {
  assert.deepEqual(
    deriveDefaultBacktestCodes('513100'),
    { highCodes: ['513100'], lowCodes: ['159501'] }
  );
  assert.deepEqual(
    deriveDefaultBacktestCodes('159501'),
    { highCodes: ['513100'], lowCodes: ['159501'] }
  );
});

test('market detail backtest prefers switch prefs classification within the same index family', () => {
  const switchPrefs = {
    benchmarkCodes: ['513100', '159501', '159660'],
    enabledCodes: [],
    premiumClass: {
      '513100': 'H',
      '159501': 'L',
      '159660': 'L'
    }
  };

  assert.deepEqual(
    deriveDefaultBacktestCodes('513100', { switchPrefs }),
    { highCodes: ['513100'], lowCodes: ['159501'] }
  );
  assert.deepEqual(
    deriveDefaultBacktestCodes('159501', { switchPrefs }),
    { highCodes: ['513100'], lowCodes: ['159501'] }
  );
});

test('market detail backtest uses price candles before display-only metric candles', () => {
  const priceCandles = [{ t: 1, c: 1.2 }, { t: 2, c: 1.3 }];
  const premiumCandles = [{ t: 1, c: 3.1 }, { t: 2, c: 2.8 }];

  assert.equal(
    selectBacktestBaseCandles({ priceCandles, displayCandles: premiumCandles }),
    priceCandles
  );
  assert.equal(
    selectBacktestBaseCandles({ priceCandles: [], displayCandles: premiumCandles }),
    premiumCandles
  );
  assert.deepEqual(
    selectBacktestBaseCandles({ priceCandles: [], displayCandles: [] }),
    []
  );
});
