"""159659/159632 模拟盘单元测试：用固定行情验证切换、扫单、取整逻辑。"""
from __future__ import annotations

import unittest
from pathlib import Path

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
        # 100 万按卖一 1.5 原可买 660000 股，但计提冲击后成本超出现金，
        # 自动缩减到能负担的 100 手整数倍
        self.assertEqual(buy["shares"], 650000)
        self.assertEqual(buy["shares"] % LOT_SHARES, 0)
        self.assertEqual(portfolio.holding_symbol(), "159659")
        # 买入有冲击成本，记录在 impact_pct
        self.assertGreater(buy["impact_pct"], 0)

        sell = portfolio.sell("159659", quote, "2026-09-28T10:01:00+08:00")
        self.assertEqual(sell["status"], "ok")
        self.assertEqual(sell["shares"], 650000)
        self.assertIsNone(portfolio.holding_symbol())
        # 买入冲击导致现金略少于 100 万（冲击约 0.24%，容忍 5000 元）
        self.assertLess(portfolio.cash, 1_000_000)
        self.assertGreater(portfolio.cash, 1_000_000 - 5000)

    def test_buy_insufficient_cash(self):
        portfolio = PaperPortfolio("test", capital=1000)
        quote = make_quote(1.5)
        buy = portfolio.buy("159659", quote, "t")
        self.assertEqual(buy["status"], "insufficient_cash")
        self.assertEqual(buy["shares"], 0)

    def test_buy_impact_scales_with_order_size(self):
        # 小单相对深盘口：冲击小；大单相对浅盘口：冲击大
        from market_collector.paper_trade import buy_price_impact
        deep_asks = [(1.5, 500000)] * 5  # 可见 250 万股
        shallow_asks = [(1.5, 10000)] * 5  # 可见 5 万股
        small_impact = buy_price_impact(10000, deep_asks)
        large_impact = buy_price_impact(390000, shallow_asks)
        self.assertGreater(large_impact, small_impact)
        self.assertLessEqual(large_impact, 0.01)  # 上限 1%
        self.assertEqual(buy_price_impact(0, deep_asks), 0.0)
        self.assertEqual(buy_price_impact(10000, []), 0.0)

    def test_buy_applies_impact_to_avg_price(self):
        portfolio = PaperPortfolio("test")
        # 浅盘口：每档 10000 股，买 390000 股远超可见深度
        asks = [(2.54, 10000), (2.55, 10000), (2.56, 10000), (2.57, 10000), (2.58, 10000)]
        quote = make_quote(2.54, asks=asks)
        buy = portfolio.buy("159632", quote, "t")
        self.assertEqual(buy["status"], "ok")
        # 可见深度 50000 股，吃单后冲击按 filled/visible 算
        self.assertGreater(buy["impact_pct"], 0)
        # 成交均价高于纯扫单均价（冲击上浮）
        _, base_cost = sweep_book(asks, buy["shares"])
        base_avg = base_cost / buy["shares"]
        self.assertGreater(buy["avg_price"], round(base_avg, 4))

    def test_market_value_falls_back_to_last_price_when_snapshot_empty(self):
        # 盘后/重启后快照为空时，用最后成交价估值，而不是只算现金
        portfolio = PaperPortfolio("test")
        quote = make_quote(2.54)
        buy = portfolio.buy("159632", quote, "t")
        self.assertEqual(buy["status"], "ok")
        # 空快照：应按最后成交价估值
        mv = portfolio.market_value({})
        self.assertGreater(mv, portfolio.cash)
        expected = round(portfolio.cash + buy["shares"] * buy["avg_price"], 2)
        self.assertEqual(mv, expected)


class EngineDelayTest(unittest.TestCase):
    def test_quant_executes_immediately_manual_in_3s(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            engine = PaperEngine(Path(tmp))
            # t=0：spread=0.5，空仓 -> quant 当即执行买 159632，manual 预约
            snapshot = make_snapshot(0.8, 0.3)
            events = engine.tick(snapshot, now_ts=1000.0)
            quant_buys = [e for e in events if e["portfolio"] == "quant"]
            manual_buys = [e for e in events if e["portfolio"] == "manual"]
            self.assertEqual(len(quant_buys), 1)
            self.assertEqual(quant_buys[0]["symbol"], "159632")
            self.assertEqual(quant_buys[0]["exec_delay_sec"], 0)
            self.assertEqual(manual_buys, [])
            self.assertNotIn("quant", engine.pending)
            self.assertIn("manual", engine.pending)

            # t=3：manual 到点执行
            events = engine.tick(snapshot, now_ts=1003.0)
            manual_buys = [e for e in events if e["portfolio"] == "manual"]
            self.assertEqual(len(manual_buys), 1)
            self.assertEqual(manual_buys[0]["symbol"], "159632")
            self.assertNotIn("manual", engine.pending)

    def test_switch_signal_executes_immediately_for_quant(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            engine = PaperEngine(Path(tmp))
            snapshot = make_snapshot(0.8, 0.3)  # spread=0.5
            engine.tick(snapshot, now_ts=1000.0)  # quant 当即建仓，manual 预约
            engine.tick(snapshot, now_ts=1003.0)  # manual 建仓
            self.assertEqual(engine.portfolios["quant"]["portfolio"].holding_symbol(), "159632")

            # spread 跌到 0.05（<0.1）：信号切回 159659，quant 当轮先卖后买
            snapshot2 = make_snapshot(0.15, 0.10)
            events = engine.tick(snapshot2, now_ts=2000.0)
            quant_events = [e for e in events if e["portfolio"] == "quant"]
            sides = [e["side"] for e in quant_events]
            self.assertEqual(sides, ["sell", "buy"])
            self.assertEqual(quant_events[0]["symbol"], "159632")
            self.assertEqual(quant_events[1]["symbol"], "159659")
            self.assertEqual(quant_events[1]["exec_delay_sec"], 0)

    def test_snapshot_persisted_to_disk_and_restored(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            engine = PaperEngine(Path(tmp))
            snapshot = make_snapshot(0.8, 0.3)
            engine.tick(snapshot, now_ts=1000.0)
            # 强制落盘
            engine._save_snapshot_disk(force=True)
            self.assertTrue((Path(tmp) / "snapshot.json").exists())
            # 新引擎应从磁盘恢复快照（价格一致即可，JSON 会把 tuple 转成 list）
            engine2 = PaperEngine(Path(tmp))
            self.assertEqual(set(engine2.last_snapshot.keys()), set(snapshot.keys()))
            for sym in snapshot:
                self.assertEqual(
                    engine2.last_snapshot[sym]["price"],
                    snapshot[sym]["price"],
                )
            self.assertEqual(engine2.last_tick, engine.last_tick)

    def test_snapshot_disk_save_is_throttled(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            engine = PaperEngine(Path(tmp))
            snapshot = make_snapshot(0.8, 0.3)
            engine.tick(snapshot, now_ts=1000.0)
            engine._save_snapshot_disk(force=True)
            mtime1 = (Path(tmp) / "snapshot.json").stat().st_mtime
            # 未强制且在节流窗口内，不应重写
            engine._save_snapshot_disk(force=False)
            mtime2 = (Path(tmp) / "snapshot.json").stat().st_mtime
            self.assertEqual(mtime1, mtime2)


if __name__ == "__main__":
    unittest.main()
