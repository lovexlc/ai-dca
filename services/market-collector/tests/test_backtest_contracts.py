import re
import unittest
from datetime import date, timedelta
from pathlib import Path
from market_collector.backtest import BacktestInputError, _buy_all, _normalize_candles, _run_rotation, run_collector_backtest
from market_collector.qdii_fund_codes import QDII_FUND_CODES


class BacktestContractsTest(unittest.TestCase):
    def test_qdii_snapshot_matches_browser(self):
        source = (Path(__file__).resolve().parents[3] / 'src/app/qdiiFundCodes.js').read_text()
        codes = set(re.findall(r'"(\d{6})"', source.split('new Set([')[1].split('])')[0]))
        self.assertEqual(codes, QDII_FUND_CODES)
        self.assertIn('159659', codes)
        self.assertNotIn('510300', codes)

    def test_nav_dates_domestic_missing_future_and_sampled_iopv(self):
        payload = {'source': 'sampled', 'candles': [{'date': '2026-06-10', 'c': 2, 'iopv': 1, 'premiumPercent': 100}]}
        for nav_date in ['2026-06-09', '2026-06-11']:
            rows = _normalize_candles(payload, '', '', '5m', {'items': [{'date': nav_date, 'nav': 1}]}, '510300')
            self.assertIsNone(rows[0]['premiumPct'])
        rows = _normalize_candles(payload, '', '', '5m', {'source': 'historical', 'items': [{'date': '2026-06-10', 'nav': 2}]}, '510300')
        self.assertEqual(rows[0]['premiumPct'], 0)
        self.assertEqual(rows[0]['navDate'], '2026-06-10')
        self.assertEqual(rows[0]['navSource'], 'historical')
        self.assertEqual(rows[0]['navAlignment'], 'same-day')

    def test_qdii_latest_previous_and_holiday_gap(self):
        payload = {'candles': [{'date': '2026-06-10', 'c': 2}, {'date': '2026-10-08', 'c': 2}]}
        nav = {'items': [{'date': '2026-06-09', 'nav': 1}, {'date': '2026-06-10', 'nav': 2}, {'date': '2026-09-30', 'nav': 1}, {'date': '2026-10-08', 'nav': 2}]}
        rows = _normalize_candles(payload, '', '', '1d', nav, '159659')
        self.assertEqual(rows[0]['navDate'], '2026-06-09')
        self.assertEqual(rows[0]['premiumPct'], 100)
        self.assertIsNone(rows[1]['nav'])

    def test_buy_cash_lots_and_minimum_fee(self):
        for cash, price, min_fee, expected in [(999, 10, 0, 0), (1000, 10, 0, 100), (1000, 10, 5, 0), (2100, 10, 150, 100)]:
            remaining, trade, position = _buy_all(cash, '510300', price, 0, min_fee, 100, ceil_lot=False)
            self.assertGreaterEqual(remaining, -1e-8)
            self.assertEqual(position['shares'] if position else 0, expected)
            if trade:
                self.assertAlmostEqual(cash - remaining, trade['amount'] + trade['fee'])

    def test_failed_target_buy_is_cash_not_completed_rotation(self):
        history = {
            '159659': [{'date': f'2026-06-{day:02}', 't': day, 'datetime': '', 'open': 1, 'close': 1, 'high': 1, 'low': 1, 'premiumPct': 3} for day in range(1, 13)],
            '159632': [{'date': f'2026-06-{day:02}', 't': day, 'datetime': '', 'open': 100, 'close': 100, 'high': 100, 'low': 100, 'premiumPct': 0} for day in range(1, 13)],
        }
        result = _run_rotation(history, ['159659'], ['159632'], initial_side='H', lower_pct=-0.5, upper_pct=0.5, initial_cash=1000, fee_rate=0, min_fee=0, lot_size=100, timeframe='1d', averages={}, data_issues=[])
        self.assertEqual(result['summary']['switchCount'], 0)
        self.assertTrue(result['signals'])
        self.assertTrue(all(not s['completed'] for s in result['signals']))
        self.assertTrue(all(r['cash'] >= 0 for r in result['rows']))
        self.assertTrue(all(r['signal'] == 'cash' for r in result['rows']))

    def test_manual_reverse_groups_and_validation(self):
        class Service:
            def kline(self, code, timeframe, limit):
                return {'candles': [{'date': (date(2026, 6, 1) + timedelta(days=i)).isoformat(), 'c': 1.03 if code == '159659' else 1} for i in range(20)]}
            def nav_history(self, code, days):
                return {'source': 'test-nav', 'items': [{'date': (date(2026, 5, 31) + timedelta(days=i)).isoformat(), 'nav': 1} for i in range(21)]}
        request = {'symbol': '159659', 'highCodes': ['159632'], 'lowCodes': ['159659'], 'mode': 'manual', 'startDate': '2026-06-01', 'endDate': '2026-06-18', 'lowerPct': -0.5, 'upperPct': 0.5}
        result = run_collector_backtest(Service(), request)['result']
        self.assertEqual(result['rotation']['effectiveHighCodes'], ['159632'])
        self.assertEqual(result['rotation']['effectiveLowCodes'], ['159659'])
        self.assertFalse(result['rotation']['autoClassified'])
        for invalid in [{'lowCodes': ['159632']}, {'lowCodes': []}]:
            with self.assertRaises(BacktestInputError):
                run_collector_backtest(Service(), {**request, **invalid})
