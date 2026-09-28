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
        "captured_at": "2026-09-28T10:00:00+08:00",
        "price": price,
        "iopv": None,
        "premium": premium,
        "premium_source": "iopv" if premium is not None else None,
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
        filled, cost, levels = sweep_book([(1.5, 100000)], 20000)
        self.assertEqual(filled, 20000)
        self.assertEqual(cost, 30000.0)
        self.assertEqual(levels, 1)

    def test_sweep_multiple_levels(self):
        # 买 25000 股：卖一 10000@1.5，卖二 20000@1.51
        filled, cost, levels = sweep_book([(1.5, 10000), (1.51, 20000)], 25000)
        self.assertEqual(filled, 25000)
        self.assertEqual(cost, round(10000 * 1.5 + 15000 * 1.51, 2))
        self.assertEqual(levels, 2)

    def test_partial_fill_when_book_thin(self):
        # 盘口只有 15000 股，要 30000 -> 部分成交
        filled, cost, levels = sweep_book([(1.5, 10000), (1.51, 5000)], 30000)
        self.assertEqual(filled, 15000)
        self.assertEqual(cost, round(10000 * 1.5 + 5000 * 1.51, 2))
        self.assertEqual(levels, 2)


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
        # 持有 159659，spread > Q(2.5) -> 切 159632；边界与回滞区无信号
        self.assertEqual(signal_target("159659", 2.51), "159632")
        self.assertIsNone(signal_target("159659", 2.5))
        self.assertIsNone(signal_target("159659", 1.0))
        # 持有 159632，spread < W(0.4) -> 切 159659
        self.assertEqual(signal_target("159632", 0.39), "159659")
        self.assertIsNone(signal_target("159632", 0.4))
        self.assertIsNone(signal_target("159632", 1.0))

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
        _, base_cost, _ = sweep_book(asks, buy["shares"])
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
            # t=0：spread=2.7（>Q），空仓 -> quant 当即执行买 159632，manual 预约
            snapshot = make_snapshot(3.0, 0.3)
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
            snapshot = make_snapshot(3.0, 0.3)  # spread=2.7（>Q）
            engine.tick(snapshot, now_ts=1000.0)  # quant 当即建仓，manual 预约
            engine.tick(snapshot, now_ts=1003.0)  # manual 建仓
            self.assertEqual(engine.portfolios["quant"]["portfolio"].holding_symbol(), "159632")

            # spread 跌到 0.2（<W）：信号切回 159659，quant 当轮先卖后买
            snapshot2 = make_snapshot(0.5, 0.3)
            events = engine.tick(snapshot2, now_ts=2000.0)
            quant_events = [e for e in events if e["portfolio"] == "quant"]
            sides = [e["side"] for e in quant_events]
            self.assertEqual(sides, ["sell", "buy"])
            self.assertEqual(quant_events[0]["symbol"], "159632")
            self.assertEqual(quant_events[1]["symbol"], "159659")
            self.assertEqual(quant_events[1]["exec_delay_sec"], 0)
            # 完整切换计一次轮换（建仓不计）
            self.assertEqual(engine.portfolios["quant"]["portfolio"].rotation_count, 1)
            self.assertEqual(engine.portfolios["manual"]["portfolio"].rotation_count, 0)

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

    def test_refresh_offhours_carries_forward_missing_iopv(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            engine = PaperEngine(Path(tmp))
            # 盘中一轮：有 IOPV 溢价
            engine.tick(make_snapshot(0.8, 0.3, price_a=2.40, price_b=2.52), now_ts=1000.0)
            # 休市一轮：腾讯只有昨收价，无 IOPV；用 refresh_offhours 只更新快照
            offhours = {
                "159659": {"symbol": "159659", "captured_at": "x", "price": 2.41,
                           "iopv": None, "premium": None, "bids": [], "asks": [], "suspended": False},
                "159632": {"symbol": "159632", "captured_at": "x", "price": 2.53,
                           "iopv": None, "premium": None, "bids": [], "asks": [], "suspended": False},
            }
            trades_before = {k: len(v["portfolio"].trades) for k, v in engine.portfolios.items()}
            pending_before = {k: dict(v) for k, v in engine.pending.items()}
            holdings_before = {k: dict(v["portfolio"].holdings) for k, v in engine.portfolios.items()}
            engine.refresh_offhours(offhours)
            # 价格更新为最新，溢价沿用上轮，持仓/成交/预约不受影响
            snap = engine.last_snapshot
            self.assertEqual(snap["159659"]["price"], 2.41)
            self.assertEqual(snap["159632"]["price"], 2.53)
            self.assertEqual(snap["159659"]["premium"], 0.8)
            self.assertEqual(snap["159632"]["premium"], 0.3)
            self.assertEqual(snap["159659"]["premium_source"], "iopv")
            for k, v in engine.portfolios.items():
                self.assertEqual(len(v["portfolio"].trades), trades_before[k])
                self.assertEqual(dict(v["portfolio"].holdings), holdings_before[k])
            self.assertEqual({k: dict(v) for k, v in engine.pending.items()}, pending_before)

    def test_refresh_offhours_falls_back_to_nav_premium(self):
        import tempfile
        from unittest import mock
        from pathlib import Path
        import market_collector.paper_trade as pt

        with tempfile.TemporaryDirectory() as tmp:
            engine = PaperEngine(Path(tmp))
            # 快照为空（重启后无盘中数据）：价格来自腾讯，溢价走日线兜底
            offhours = {
                "159659": {"symbol": "159659", "captured_at": "x", "price": 2.412,
                           "iopv": None, "premium": None, "bids": [], "asks": [], "suspended": False},
                "159632": {"symbol": "159632", "captured_at": "x", "price": 2.528,
                           "iopv": None, "premium": None, "bids": [], "asks": [], "suspended": False},
            }
            fake = {"159659": {"premium": 8.9283, "price": 2.412, "date": "2026-09-28"},
                    "159632": {"premium": 8.5724, "price": 2.528, "date": "2026-09-28"}}
            with mock.patch.object(pt, "fetch_latest_premium", side_effect=lambda s: fake.get(s)):
                engine.refresh_offhours(offhours)
            snap = engine.last_snapshot
            self.assertEqual(snap["159659"]["premium"], 8.9283)
            self.assertEqual(snap["159632"]["premium"], 8.5724)
            self.assertEqual(snap["159659"]["premium_source"], "nav")
            # 快照落盘，重启可恢复
            self.assertTrue((Path(tmp) / "snapshot.json").exists())


class TradeFieldsTest(unittest.TestCase):
    def test_buy_records_fee_counter_price_levels(self):
        from market_collector.paper_trade import FEE_RATE
        portfolio = PaperPortfolio("test")
        quote = make_quote(1.5)
        buy = portfolio.buy("159659", quote, "t")
        self.assertEqual(buy["status"], "ok")
        # 手续费 = 成交金额 * 万0.5
        self.assertAlmostEqual(buy["fee"], round(buy["amount"] * FEE_RATE, 2))
        self.assertGreater(buy["fee"], 0)
        # 对手一档价 = 卖一价
        self.assertEqual(buy["counter_price"], quote["asks"][0][0])
        # 吃档数 >= 1
        self.assertGreaterEqual(buy["levels_consumed"], 1)
        # 冲击成本金额 > 0，且累计进组合
        self.assertGreater(buy["impact_cost"], 0)
        self.assertAlmostEqual(portfolio.total_impact_cost, buy["impact_cost"])
        self.assertAlmostEqual(portfolio.total_fees, buy["fee"])

    def test_sell_records_fee_no_impact(self):
        from market_collector.paper_trade import FEE_RATE
        portfolio = PaperPortfolio("test")
        quote = make_quote(1.5)
        portfolio.buy("159659", quote, "t")
        fees_after_buy = portfolio.total_fees
        sell = portfolio.sell("159659", quote, "t")
        self.assertEqual(sell["status"], "ok")
        self.assertAlmostEqual(sell["fee"], round(sell["amount"] * FEE_RATE, 2))
        self.assertGreater(sell["fee"], 0)
        self.assertEqual(sell["impact_cost"], 0.0)
        self.assertEqual(sell["counter_price"], quote["bids"][0][0])
        self.assertGreaterEqual(sell["levels_consumed"], 1)
        self.assertAlmostEqual(portfolio.total_fees, round(fees_after_buy + sell["fee"], 2))


class EngineHistoryTest(unittest.TestCase):
    def _engine(self, tmpdir):
        import tempfile
        from pathlib import Path
        return PaperEngine(Path(tmpdir))

    def test_history_records_nav_and_spread(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            engine = self._engine(tmp)
            engine.tick(make_snapshot(3.0, 0.3), now_ts=1000.0)
            engine.tick(make_snapshot(3.0, 0.3), now_ts=1001.0)
            hist = engine.history(limit=10)
            self.assertEqual(len(hist["nav"]), 2)
            self.assertEqual(len(hist["spread"]), 2)
            self.assertIn("quant", hist["nav"][0])
            self.assertIn("manual", hist["nav"][0])
            self.assertAlmostEqual(hist["spread"][0]["spread"], 2.7)
            self.assertEqual(hist["tick_seq"], 2)

    def test_status_exposes_strategy_depth_and_tick(self):
        from market_collector.paper_trade import Q_THRESHOLD, W_THRESHOLD, FEE_RATE
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            engine = self._engine(tmp)
            engine.tick(make_snapshot(3.0, 0.3), now_ts=1000.0)
            status = engine.status()
            self.assertEqual(status["tick_seq"], 1)
            strategy = status["strategy"]
            self.assertEqual(strategy["q_threshold"], Q_THRESHOLD)
            self.assertEqual(strategy["w_threshold"], W_THRESHOLD)
            self.assertEqual(strategy["fee_rate"], FEE_RATE)
            self.assertEqual(strategy["symbols"], ["159659", "159632"])
            q659 = status["quotes"]["159659"]
            self.assertEqual(len(q659["bids"]), 5)
            self.assertEqual(len(q659["asks"]), 5)
            self.assertIsNotNone(q659["quote_ts"])
            quant = status["portfolios"]["quant"]
            self.assertIn("total_fees", quant)
            self.assertIn("total_impact_cost", quant)
            self.assertIn("rotation_count", quant)

    def test_history_survives_disk_snapshot(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp:
            engine = self._engine(tmp)
            engine.tick(make_snapshot(3.0, 0.3), now_ts=1000.0)
            engine.tick(make_snapshot(3.0, 0.3), now_ts=1001.0)
            engine._save_snapshot_disk(force=True)
            engine2 = self._engine(tmp)
            self.assertEqual(engine2.tick_seq, 2)
            hist = engine2.history(limit=10)
            self.assertEqual(len(hist["nav"]), 2)
            self.assertEqual(len(hist["spread"]), 2)


if __name__ == "__main__":
    unittest.main()
