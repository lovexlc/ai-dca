"""159659/159632 模拟盘单元测试：用固定行情验证切换、扫单、取整逻辑。"""
from __future__ import annotations

import unittest

from market_collector.paper_trade import (
    LOT_SHARES,
    PaperEngine,
    PaperPortfolio,
    max_buyable_shares,
    parse_tencent_depth,
    round_down_lots,
    signal_target,
    sweep_book,
)


def make_quote(price, bids=None, asks=None, premium=None):
    # 每档 200000 股，5 档共 100 万股，保证 660000 股能全额成交
    book = [(1.50, 200000), (1.51, 200000), (1.52, 200000), (1.53, 200000), (1.54, 200000)]
    return {
        "symbol": "159659",
        "price": price,
        "iopv": None,
        "premium": premium,
        "bids": bids if bids is not None else list(book),
        "asks": asks if asks is not None else list(book),
        "suspended": False,
    }


def make_snapshot(prem_a, prem_b, price_a=1.5, price_b=1.5):
    # 默认盘口充足：每档 200000 股
    book = [(1.50, 200000), (1.51, 200000), (1.52, 200000), (1.53, 200000), (1.54, 200000)]
    return {
        "159659": make_quote(price_a, bids=list(book), asks=list(book), premium=prem_a),
        "159632": make_quote(price_b, bids=list(book), asks=list(book), premium=prem_b),
    }


class DepthParseTest(unittest.TestCase):
    def test_parse_bid_ask_depth(self):
        # 构造腾讯格式：fields[9]/[10]=买一价/量 … fields[27]/[28]=卖五价/量
        fields = ["1", "招商纳指ETF", "159659", "1.523", "1.510", "1.515", "1000", "0", "0"]
        # 买一..买五
        for i in range(5):
            fields += [f"{1.52 - i * 0.001:.3f}", str(100 + i * 10)]
        # 卖一..卖五
        for i in range(5):
            fields += [f"{1.524 + i * 0.001:.3f}", str(120 + i * 10)]
        fields += ["20260928100000"]
        payload = 'v_sz159659="%s";' % "~".join(fields)
        result = parse_tencent_depth(payload)
        row = result["159659"]
        self.assertEqual(row["price"], 1.523)
        self.assertEqual(len(row["bids"]), 5)
        self.assertEqual(len(row["asks"]), 5)
        # 买一价 1.520，量 100 手 = 10000 股
        self.assertEqual(row["bids"][0], (1.52, 10000))
        # 卖一价 1.524，量 120 手 = 12000 股
        self.assertEqual(row["asks"][0], (1.524, 12000))


class SweepBookTest(unittest.TestCase):
    def test_full_fill_single_level(self):
        filled, cost = sweep_book([(1.5, 100000)], 20000)
        self.assertEqual(filled, 20000)
        self.assertEqual(cost, 30000.0)

    def test_sweep_multiple_levels(self):
        # 买 25000 股：卖一 10000@1.5，卖二 20000@1.51
        filled, cost = sweep_book([(1.5, 10000), (1.51, 20000)], 25000)
        self.assertEqual(filled, 25000)
        self.assertEqual(cost, round(10000 * 1.5 + 15000 * 1.51, 2))

    def test_partial_fill_when_book_thin(self):
        # 盘口只有 15000 股，要 30000 -> 部分成交
        filled, cost = sweep_book([(1.5, 10000), (1.51, 5000)], 30000)
        self.assertEqual(filled, 15000)
        self.assertEqual(cost, round(10000 * 1.5 + 5000 * 1.51, 2))


class LotRoundingTest(unittest.TestCase):
    def test_round_down_to_100_lots(self):
        self.assertEqual(round_down_lots(123456), 120000)
        self.assertEqual(round_down_lots(10000), 10000)
        self.assertEqual(round_down_lots(9999), 0)

    def test_max_buyable_shares(self):
        # 100 万按 1.5 元：666666 股 -> 向下取整 660000
        self.assertEqual(max_buyable_shares(1_000_000, 1.5), 660000)
        # 金额不足 100 手时返回 0
        self.assertEqual(max_buyable_shares(1000, 1.5), 0)


class SignalTest(unittest.TestCase):
    def test_initial_buy_lower_premium(self):
        # spread = 0.5 > 0，159659 溢价更高 -> 买 159632
        self.assertEqual(signal_target(None, 0.5), "159632")
        # spread = -0.2，159632 溢价更高 -> 买 159659
        self.assertEqual(signal_target(None, -0.2), "159659")

    def test_switch_thresholds(self):
        # 持有 159659，spread > 0.3 -> 切 159632
        self.assertEqual(signal_target("159659", 0.31), "159632")
        self.assertIsNone(signal_target("159659", 0.3))
        self.assertIsNone(signal_target("159659", 0.2))
        # 持有 159632，spread < 0.1 -> 切 159659
        self.assertEqual(signal_target("159632", 0.09), "159659")
        self.assertIsNone(signal_target("159632", 0.1))
        self.assertIsNone(signal_target("159632", 0.2))

    def test_no_signal_without_premium(self):
        self.assertIsNone(signal_target("159659", None))
        self.assertIsNone(signal_target(None, None))


class PortfolioTradeTest(unittest.TestCase):
    def test_buy_and_sell_roundtrip(self):
        portfolio = PaperPortfolio("test")
        quote = make_quote(1.5)
        buy = portfolio.buy("159659", quote, "2026-09-28T10:00:00+08:00")
        self.assertEqual(buy["status"], "ok")
        self.assertEqual(buy["shares"], 660000)  # 100 万按卖一 1.5
        self.assertEqual(buy["shares"] % LOT_SHARES, 0)
        self.assertEqual(portfolio.holding_symbol(), "159659")

        sell = portfolio.sell("159659", quote, "2026-09-28T10:01:00+08:00")
        self.assertEqual(sell["status"], "ok")
        self.assertEqual(sell["shares"], 660000)
        self.assertIsNone(portfolio.holding_symbol())
        # 买卖都按 1.5 成交，现金基本回原（浮点舍入误差容忍 1 元）
        self.assertAlmostEqual(portfolio.cash, 1_000_000, delta=1.0)

    def test_buy_insufficient_cash(self):
        portfolio = PaperPortfolio("test", capital=1000)
        quote = make_quote(1.5)
        buy = portfolio.buy("159659", quote, "t")
        self.assertEqual(buy["status"], "insufficient_cash")
        self.assertEqual(buy["shares"], 0)


class EngineDelayTest(unittest.TestCase):
    def test_quant_executes_in_1s_manual_in_3s(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            engine = PaperEngine(Path(tmp))
            # t=0：spread=0.5，空仓 -> 两组合都预约买 159632
            snapshot = make_snapshot(0.8, 0.3)
            events = engine.tick(snapshot, now_ts=1000.0)
            self.assertEqual(events, [])  # 未到执行时间
            for name in ("quant", "manual"):
                self.assertIn(name, engine.pending)

            # t=1：quant 到点执行，manual 还在等
            events = engine.tick(snapshot, now_ts=1001.0)
            quant_buys = [e for e in events if e["portfolio"] == "quant"]
            manual_buys = [e for e in events if e["portfolio"] == "manual"]
            self.assertEqual(len(quant_buys), 1)
            self.assertEqual(quant_buys[0]["symbol"], "159632")
            self.assertEqual(manual_buys, [])
            self.assertNotIn("quant", engine.pending)
            self.assertIn("manual", engine.pending)

            # t=3：manual 到点执行
            events = engine.tick(snapshot, now_ts=1003.0)
            manual_buys = [e for e in events if e["portfolio"] == "manual"]
            self.assertEqual(len(manual_buys), 1)
            self.assertEqual(manual_buys[0]["symbol"], "159632")
            self.assertNotIn("manual", engine.pending)

    def test_switch_signal_executes_with_delay(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            engine = PaperEngine(Path(tmp))
            snapshot = make_snapshot(0.8, 0.3)  # spread=0.5
            engine.tick(snapshot, now_ts=1000.0)
            engine.tick(snapshot, now_ts=1003.0)  # 两组合都建仓 159632
            self.assertEqual(engine.portfolios["quant"]["portfolio"].holding_symbol(), "159632")

            # spread 跌到 0.05（<0.1）：信号切回 159659
            snapshot2 = make_snapshot(0.15, 0.10)
            events = engine.tick(snapshot2, now_ts=2000.0)
            self.assertEqual(events, [])
            # t=2001：quant 先卖 159632 再买 159659
            events = engine.tick(snapshot2, now_ts=2001.0)
            quant_events = [e for e in events if e["portfolio"] == "quant"]
            sides = [e["side"] for e in quant_events]
            self.assertEqual(sides, ["sell", "buy"])
            self.assertEqual(quant_events[0]["symbol"], "159632")
            self.assertEqual(quant_events[1]["symbol"], "159659")


if __name__ == "__main__":
    unittest.main()
