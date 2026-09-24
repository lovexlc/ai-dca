import { test } from 'node:test';
import assert from 'node:assert/strict';

import { calculateCompositeTemp, selectWeatherState } from '../src/pages/markets/marketSentimentWeather.js';

test('0 sunny and 14 rainy produces a rainy temperature and weather state', () => {
  const breadth = { up: 0, down: 14 };
  const compositeTemp = calculateCompositeTemp({
    ndxChange: 0,
    fearGreed: 29,
    vix: 14.81,
    breadth,
  });

  assert.ok(compositeTemp < 0);
  assert.equal(selectWeatherState({ compositeTemp, fearGreed: 29, vix: 14.81, breadth }).name, '细雨连绵');
});

test('rainy breadth caps sunny readings while storm thresholds retain priority', () => {
  const breadth = { up: 3, down: 11 };
  assert.equal(selectWeatherState({ compositeTemp: 30, fearGreed: 80, vix: 15, breadth }).name, '细雨连绵');
  assert.equal(selectWeatherState({ compositeTemp: 30, fearGreed: 10, vix: 35, breadth }).name, '恐慌雷暴');
});

test('broad advances can still produce sunny weather', () => {
  const weather = selectWeatherState({
    compositeTemp: 26,
    fearGreed: 60,
    vix: 15,
    breadth: { up: 14, down: 0 },
  });
  assert.equal(weather.name, '艳阳高照');
});
