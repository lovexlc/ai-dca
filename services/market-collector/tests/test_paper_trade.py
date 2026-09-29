"""纳指100ETF 全市场轮动多Q并行模拟盘单元测试：用固定行情验证切换、扫单、取整逻辑。"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

# 支持从仓库根目录直接运行：python -m pytest services/market-collector/tests/test_paper_trade.py
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from market_collector.paper_trade import (
    LOT_SHARES,
    MIN_ORDER_SHARES,
    PaperEngine,
    PaperPortfolio,
    max_buyable_shares,
    parse_tencent_depth,
    round_order_shares,
    signal_reason,
    signal_target,
    sweep_book,
)

UNIVERSE = ("159696", "159659", "513300", "159660", "513870", "159632")


def make_quote(symbol, price=1.5, premium=None, bids=None, asks=None):
    # 每档 200000 股，5 档共 100 万股，保证 660000 股能全额成交
    book = [(1.50, 200000), (1.51, 200000), (1.52, 200000), (1.53, 200000), (1.54, 200000)]
    return {
        "symbol": symbol,
        "captured_at": "2026-09-28T10:00:00+08:00",
        "price": price,
        "iopv": None,
        "premium": premium,
        "premium_source": "iopv" if premium is not None else None,
        "bids": bids if bids is not None else list(book),
        "asks": asks if asks is not None else list(book),
        "suspended": False,
    }


def make_snapshot(premiums):
    """按溢价字典构造 6 标的快照；缺省代码的溢价视为缺失（None）。"""
    return {s: make_quote(s, premium=premiums.get(s)) for s in UNIVERSE}


# 溢价取二进制可精确表示的数，保证边界断言（gap == Q）不受浮点误差影响
PREMIUMS = {
    "159696": 3.0,
    "159659": 2.0,
    "513300": 1.5,
    "159660": 1.0,
    "513870": 0.5,
    "159632": 0.25,
}


class DepthParseTest(unittest.TestCase):
    def _payload(self, prefix, name, code, price):
        # 构造腾讯格式：fields[9]/[10]=买一价/量 … fields[27]/[28]=卖五价/量
        fields = ["1", name, code, str(price), "1.510", "1.515", "1000", "0", "0"]
        for i in range(5):
            fields += [f"{1.52 - i * 0.001:.3f}", str(100 + i * 10)]
        for i in range(5):
            fields += [f"{1.524 + i * 0.001:.3f}", str(120 + i * 10)]
        fields += ["20260928100000"]
        return f'v_{prefix}{code}="' + "~".join(fields) + '";'

    def test_parse_bid_ask_depth_sz(self):
        payload = self._payload("sz", "招商纳指ETF", "159659", 1.523)
        result = parse_tencent_depth(payload)
        row = result["159659"]
        self.assertEqual(row["price"], 1.523)
        self.assertEqual(len(row["bids"]), 5)
        self.assertEqual(len(row["asks"]), 5)
        # 买一价 1.520，量 100 手 = 10000 股
        self.assertEqual(row["bids"][0], (1.52, 10000))
        # 卖一价 1.524，量 120 手 = 12000 股
        self.assertEqual(row["asks"][0], (1.524, 12000))

    def test_parse_bid_ask_depth_sh(self):
        # 沪市标的（513300/513870）在腾讯用 sh 前缀，解析按代码过滤
        payload = self._payload("sh", "华夏纳指ETF", "513300", 2.101)
        result = parse_tencent_depth(payload)
        row = result["513300"]
        self.assertEqual(row["price"], 2.101)
        self.assertEqual(len(row["bids"]), 5)
        self.assertEqual(len(row["asks"]), 5)


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
    def test_round_order_shares(self):
        # 100 股/笔向下取整，不足 100 股返回 0
        self.assertEqual(round_order_shares(123456), 123400)
        self.assertEqual(round_order_shares(120050), 120000)
        self.assertEqual(round_order_shares(10000), 10000)
        self.assertEqual(round_order_shares(9999), 9900)
        self.assertEqual(round_order_shares(100), 100)
        self.assertEqual(round_order_shares(99), 0)

    def test_max_buyable_shares(self):
        # 100 万按 1.5 元：666666 股 -> 取整 666600
        self.assertEqual(max_buyable_shares(1_000_000, 1.5), 666600)
        self.assertEqual(max_buyable_shares(1000, 1.5), 600)
        # 金额不足 100 股时返回 0
        self.assertEqual(max_buyable_shares(100, 1.5), 0)


class SignalTargetTest(unittest.TestCase):
    def test_initial_buy_cheapest(self):
        # 空仓建仓：买全市场溢价最低者
        self.assertEqual(signal_target(None, PREMIUMS, 0.3), "159632")

    def test_holding_highest_must_switch(self):
        # 持仓为全市场最高时必触发切换（gap 2.75 > Q）
        self.assertEqual(signal_target("159696", PREMIUMS, 0.3), "159632")
        # gap == Q 为边界，严格大于才触发
        self.assertIsNone(signal_target("159696", PREMIUMS, 2.75))

    def test_gap_within_q_holds(self):
        # （持仓 − 最低）≤ Q 时持有不动；gap == Q 为边界（严格大于才触发）
        self.assertIsNone(signal_target("159659", PREMIUMS, 2.0))  # gap 1.75 < Q 2.0
        self.assertIsNone(signal_target("159659", PREMIUMS, 1.75))  # gap == Q 不动
        self.assertEqual(signal_target("159659", PREMIUMS, 1.5), "159632")  # gap > Q 触发

    def test_holding_is_cheapest_holds(self):
        # 持仓即全市场最低：gap 0，任何非负 Q 都不动
        self.assertIsNone(signal_target("159632", PREMIUMS, 0.1))

    def test_multi_q_isolation(self):
        # 同一行情下不同 Q 行为不同：持仓 159660（gap 0.75）
        self.assertEqual(signal_target("159660", PREMIUMS, 0.5), "159632")
        self.assertIsNone(signal_target("159660", PREMIUMS, 1.0))

    def test_missing_premium_no_signal(self):
        # 全市场溢价缺失：无信号
        empty = {s: None for s in UNIVERSE}
        self.assertIsNone(signal_target(None, empty, 0.1))
        self.assertIsNone(signal_target("159696", empty, 0.1))
        # 持仓自身溢价缺失：不动（不能按残缺数据换仓）
        partial = dict(PREMIUMS, **{"159696": None})
        self.assertIsNone(signal_target("159696", partial, 0.1))
        # 部分标的溢价缺失：只在有溢价的标的中比较
        partial = dict(PREMIUMS, **{"159696": None, "513300": None, "159632": None})
        self.assertEqual(signal_target(None, partial, 0.1), "513870")
        self.assertEqual(signal_target("159659", partial, 0.1), "513870")

    def test_cheapest_tie_breaks_by_universe_order(self):
        # 溢价并列时取宇宙顺序靠前者（159696 与 159659 并列最低 -> 选 159696）
        tie = {"159696": 1.0, "159659": 1.0, "513300": 2.0, "159660": 2.0,
               "513870": 2.0, "159632": 2.0}
        self.assertEqual(signal_target(None, tie, 0.1), "159696")
        self.assertEqual(signal_target("513300", tie, 0.1), "159696")
        # 持仓自身即并列最低之一（gap 0）：不触发无意义换仓
        all_tie = {s: 1.0 for s in UNIVERSE}
        self.assertIsNone(signal_target("159659", all_tie, 0.1))


class SignalReasonTest(unittest.TestCase):
    """交易原因文案：与 signal_target 的分支一一对应，百分比 4 位小数。"""

    def test_reason_initial_buy(self):
        reason = signal_reason(None, PREMIUMS, "159632", 0.3)
        self.assertEqual(reason, "启动建仓：买入全市场溢价最低的159632（0.2500%）")

    def test_reason_rotation(self):
        reason = signal_reason("159696", PREMIUMS, "159632", 0.3)
        self.assertEqual(
            reason,
            "159696溢价3.0000%较全市场最低159632(0.2500%)高出2.7500pp（>Q阈值0.3000%）：159696→159632",
        )

    def test_reason_missing_premium(self):
        empty = {s: None for s in UNIVERSE}
        self.assertEqual(signal_reason(None, empty, "159632", 0.1), "溢价数据缺失")
        self.assertEqual(signal_reason("159696", empty, "159632", 0.1), "溢价数据缺失")


class PortfolioTradeTest(unittest.TestCase):
    def test_buy_and_sell_roundtrip(self):
        portfolio = PaperPortfolio("test")
        quote = make_quote("159659", 1.5)
        buy = portfolio.buy("159659", quote, "2026-09-28T10:00:00+08:00")
        self.assertEqual(buy["status"], "ok")
        # 100 万按卖一 1.5 原可买 666666 股，但计提冲击后成本超出现金，
        # 自动缩减到能负担的下单粒度（100 股整数倍）
        self.assertGreater(buy["shares"], 650000)
        self.assertEqual(buy["shares"] % LOT_SHARES, 0)
        self.assertEqual(portfolio.holding_symbol(), "159659")
        # 买入有冲击成本，记录在 impact_pct
        self.assertGreater(buy["impact_pct"], 0)

        sell = portfolio.sell("159659", quote, "2026-09-28T10:01:00+08:00")
        self.assertEqual(sell["status"], "ok")
        self.assertEqual(sell["shares"], buy["shares"])
        self.assertIsNone(portfolio.holding_symbol())
        # 买入冲击导致现金略少于 100 万（冲击约 0.24%，容忍 5000 元）
        self.assertLess(portfolio.cash, 1_000_000)
        self.assertGreater(portfolio.cash, 1_000_000 - 5000)

    def test_portfolio_q_field_roundtrip(self):
        portfolio = PaperPortfolio("test", q=0.1)
        self.assertEqual(portfolio.q, 0.1)
        self.assertEqual(PaperPortfolio.from_dict(portfolio.to_dict()).q, 0.1)
        # 默认无阈值（归档/旧状态兼容）
        self.assertIsNone(PaperPortfolio("test").q)

    def test_buy_insufficient_cash(self):
        portfolio = PaperPortfolio("test", capital=100)
        quote = make_quote("159659", 1.5)
        buy = portfolio.buy("159659", quote, "t")
        self.assertEqual(buy["status"], "insufficient_cash")
        self.assertEqual(buy["shares"], 0)

    def test_buy_rounds_down_to_100_shares(self):
        # 38499 元按 1.5 元可买 25666 股：向下取整到 100 股的整数倍
        portfolio = PaperPortfolio("test", capital=38499)
        quote = make_quote("159659", 1.5)
        buy = portfolio.buy("159659", quote, "t")
        self.assertEqual(buy["status"], "ok")
        self.assertGreater(buy["shares"], 25000)
        self.assertEqual(buy["shares"] % LOT_SHARES, 0)
        self.assertEqual(portfolio.holdings["159659"], buy["shares"])

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
        quote = make_quote("159632", 2.54, asks=asks)
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
        quote = make_quote("159632", 2.54)
        buy = portfolio.buy("159632", quote, "t")
        self.assertEqual(buy["status"], "ok")
        # 空快照：应按最后成交价估值
        mv = portfolio.market_value({})
        self.assertGreater(mv, portfolio.cash)
        expected = round(portfolio.cash + buy["shares"] * buy["avg_price"], 2)
        self.assertEqual(mv, expected)


class EngineDelayTest(unittest.TestCase):
    def _engine(self, tmpdir):
        return PaperEngine(Path(tmpdir))

    def test_delay_zero_executes_immediately_manual_pending_in_3s(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            engine = self._engine(tmp)
            # t=0：空仓 -> 3 个实时盘当即建仓买最低，手动盘预约
            snapshot = make_snapshot(PREMIUMS)
            events = engine.tick(snapshot, now_ts=1000.0)
            instant_buys = [e for e in events if e["side"] == "buy" and e["exec_delay_sec"] == 0]
            self.assertEqual([e["portfolio"] for e in instant_buys],
                             ["quant-q01", "quant-q02", "quant-q03"])
            self.assertTrue(all(e["symbol"] == "159632" for e in instant_buys))
            self.assertNotIn("quant-q01", engine.pending)
            self.assertNotIn("quant-q03", engine.pending)
            self.assertIn("manual-q01", engine.pending)
            self.assertNotIn("quant", engine.pending)
            self.assertNotIn("manual", engine.pending)

            # t=3：manual-q01 到点执行建仓
            events = engine.tick(snapshot, now_ts=1003.0)
            manual_buys = [e for e in events if e["portfolio"] == "manual-q01"]
            self.assertEqual(len(manual_buys), 1)
            self.assertEqual(manual_buys[0]["symbol"], "159632")
            self.assertEqual(manual_buys[0]["exec_delay_sec"], 3)
            self.assertNotIn("manual-q01", engine.pending)

    def test_multi_q_isolation_same_market(self):
        # 同一行情下 q=0.1 触发轮动、q=0.3 不动：引擎按各盘自己的 Q 跑
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            engine = self._engine(tmp)
            # 先让各盘建仓持有最低溢价者 159632（0.25）
            engine.tick(make_snapshot(PREMIUMS), now_ts=1000.0)
            engine.tick(make_snapshot(PREMIUMS), now_ts=1010.0)
            self.assertEqual(engine.portfolios["quant-q01"]["portfolio"].holding_symbol(), "159632")
            # 行情反转：159632 溢价 0.5，其余 0.25（并列取宇宙靠前 159696 为最低）
            rotated = dict(PREMIUMS, **{"159632": 0.5, "159696": 0.25,
                                        "159659": 0.25, "513300": 0.25, "159660": 0.25})
            events = engine.tick(make_snapshot(rotated), now_ts=2000.0)
            by_portfolio = {}
            for e in events:
                by_portfolio.setdefault(e["portfolio"], []).append(e)
            # gap = 0.25：q=0.1/0.2 轮换（卖旧买新），q=0.3 不动
            for key in ("quant-q01", "quant-q02"):
                self.assertEqual([e["side"] for e in by_portfolio.get(key, [])], ["sell", "buy"],
                                 f"{key} 应触发轮动")
                self.assertEqual(by_portfolio[key][0]["symbol"], "159632")
                self.assertEqual(by_portfolio[key][1]["symbol"], "159696")
            self.assertNotIn("quant-q03", by_portfolio)
            self.assertEqual(engine.portfolios["quant-q01"]["portfolio"].holding_symbol(), "159696")
            self.assertEqual(engine.portfolios["quant-q02"]["portfolio"].holding_symbol(), "159696")
            self.assertEqual(engine.portfolios["quant-q03"]["portfolio"].holding_symbol(), "159632")

    def test_rotation_counted_only_for_full_switch(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            engine = self._engine(tmp)
            engine.tick(make_snapshot(PREMIUMS), now_ts=1000.0)
            self.assertEqual(engine.portfolios["quant-q01"]["portfolio"].rotation_count, 0)
            rotated = dict(PREMIUMS, **{"159632": 0.5, "159696": 0.25,
                                        "159659": 0.25, "513300": 0.25, "159660": 0.25})
            engine.tick(make_snapshot(rotated), now_ts=2000.0)
            self.assertEqual(engine.portfolios["quant-q01"]["portfolio"].rotation_count, 1)

    def test_delayed_rotation_reason_uses_signal_time_premiums(self):
        # 手动盘 3 秒后执行：换仓原因按信号时点的溢价生成，并记录信号时点溢价差
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            engine = self._engine(tmp)
            engine.tick(make_snapshot(PREMIUMS), now_ts=1000.0)
            engine.tick(make_snapshot(PREMIUMS), now_ts=1003.0)  # manual-q01 建仓
            rotated = dict(PREMIUMS, **{"159632": 0.5, "159696": 0.25,
                                        "159659": 0.25, "513300": 0.25, "159660": 0.25})
            engine.tick(make_snapshot(rotated), now_ts=2000.0)  # manual-q01 预约轮换
            # 之后行情再变也不影响预约里信号时点的数据
            drifted = dict(rotated, **{"159632": 3.0})
            events = engine.tick(make_snapshot(drifted), now_ts=2010.0)
            manual_events = [e for e in events if e["portfolio"] == "manual-q01"]
            self.assertEqual([e["side"] for e in manual_events], ["sell", "buy"])
            reason = ("159632溢价0.5000%较全市场最低159696(0.2500%)"
                      "高出0.2500pp（>Q阈值0.1000%）：159632→159696")
            self.assertEqual([e["reason"] for e in manual_events], [reason, reason])
            buy = manual_events[1]
            self.assertEqual(buy["signal_gap"], 0.25)
            self.assertEqual(buy["exec_delay_sec"], 3)
            self.assertEqual(engine.portfolios["manual-q01"]["portfolio"].rotation_count, 1)

    def test_only_configured_portfolios_tick(self):
        # 只有 PORTFOLIO_SPECS 里的 4 个盘参与 tick
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            engine = self._engine(tmp)
            self.assertEqual(set(engine.portfolios), {"quant-q01", "quant-q02", "quant-q03", "manual-q01"})
            rotated = dict(PREMIUMS, **{"159632": 3.0})
            for ts in (1000.0, 1010.0, 1020.0):
                events = engine.tick(make_snapshot(rotated), now_ts=ts)
                self.assertTrue(all(e["portfolio"] in engine.portfolios for e in events))
            # 新盘正常建仓（159632 拉高到 3.0 后最低溢价者为 513870）
            self.assertEqual(engine.portfolios["quant-q01"]["portfolio"].holding_symbol(), "513870")

    def test_snapshot_persisted_to_disk_and_restored(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            engine = self._engine(tmp)
            snapshot = make_snapshot(PREMIUMS)
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
            engine = self._engine(tmp)
            engine.tick(make_snapshot(PREMIUMS), now_ts=1000.0)
            engine._save_snapshot_disk(force=True)
            mtime1 = (Path(tmp) / "snapshot.json").stat().st_mtime
            # 未强制且在节流窗口内，不应重写
            engine._save_snapshot_disk(force=False)
            mtime2 = (Path(tmp) / "snapshot.json").stat().st_mtime
            self.assertEqual(mtime1, mtime2)

    def test_refresh_offhours_carries_forward_missing_iopv(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            engine = self._engine(tmp)
            # 盘中一轮：有 IOPV 溢价
            engine.tick(make_snapshot(PREMIUMS), now_ts=1000.0)
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
            self.assertEqual(snap["159659"]["premium"], 2.0)
            self.assertEqual(snap["159632"]["premium"], 0.25)
            self.assertEqual(snap["159659"]["premium_source"], "iopv")
            for k, v in engine.portfolios.items():
                self.assertEqual(len(v["portfolio"].trades), trades_before[k])
                self.assertEqual(dict(v["portfolio"].holdings), holdings_before[k])
            self.assertEqual({k: dict(v) for k, v in engine.pending.items()}, pending_before)

    def test_refresh_offhours_falls_back_to_nav_premium(self):
        import tempfile
        from unittest import mock
        import market_collector.paper_trade as pt

        with tempfile.TemporaryDirectory() as tmp:
            engine = self._engine(tmp)
            # 快照为空（重启后无盘中数据）：价格来自腾讯，溢价走日线兜底
            offhours = {
                s: {"symbol": s, "captured_at": "x", "price": 2.4,
                    "iopv": None, "premium": None, "bids": [], "asks": [], "suspended": False}
                for s in UNIVERSE
            }
            fake = {
                "159696": {"premium": 8.9283, "price": 2.4, "date": "2026-09-28"},
                "159659": {"premium": 8.5724, "price": 2.4, "date": "2026-09-28"},
                "513300": {"premium": 8.0102, "price": 2.4, "date": "2026-09-28"},
                "159660": {"premium": 7.9321, "price": 2.4, "date": "2026-09-28"},
                "513870": {"premium": 7.8117, "price": 2.4, "date": "2026-09-28"},
                "159632": {"premium": 7.7250, "price": 2.4, "date": "2026-09-28"},
            }
            with mock.patch.object(pt, "fetch_latest_premium", side_effect=lambda s: fake.get(s)):
                engine.refresh_offhours(offhours)
            snap = engine.last_snapshot
            self.assertEqual(snap["159659"]["premium"], 8.5724)
            self.assertEqual(snap["159632"]["premium"], 7.7250)
            self.assertEqual(snap["159632"]["premium_source"], "nav")
            # 快照落盘，重启可恢复
            self.assertTrue((Path(tmp) / "snapshot.json").exists())


class TradeReasonTest(unittest.TestCase):
    """引擎成交事件 reason 文案：建仓/轮动分支与 signal_reason 一致。"""

    def _engine(self, tmpdir):
        return PaperEngine(Path(tmpdir))

    def test_reason_initial_buy(self):
        # 建仓：空仓启动，买入全市场溢价最低的 159632（0.25%）
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            engine = self._engine(tmp)
            events = engine.tick(make_snapshot(PREMIUMS), now_ts=1000.0)
            buys = [e for e in events if e["portfolio"] == "quant-q01" and e["side"] == "buy"]
            self.assertEqual(len(buys), 1)
            self.assertEqual(buys[0]["symbol"], "159632")
            self.assertEqual(buys[0]["reason"], "启动建仓：买入全市场溢价最低的159632（0.2500%）")

    def test_reason_rotation(self):
        # 轮动：持仓溢价高出全市场最低超 Q，卖旧买新共用同一 reason
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            engine = self._engine(tmp)
            engine.tick(make_snapshot(PREMIUMS), now_ts=1000.0)  # 建仓 159632
            rotated = dict(PREMIUMS, **{"159632": 3.5, "159696": 0.25})
            events = engine.tick(make_snapshot(rotated), now_ts=2000.0)
            q01_events = [e for e in events if e["portfolio"] == "quant-q01"]
            self.assertEqual([e["side"] for e in q01_events], ["sell", "buy"])
            self.assertEqual([e["symbol"] for e in q01_events], ["159632", "159696"])
            reason = ("159632溢价3.5000%较全市场最低159696(0.2500%)"
                      "高出3.2500pp（>Q阈值0.1000%）：159632→159696")
            self.assertEqual([e["reason"] for e in q01_events], [reason, reason])


class TradeFieldsTest(unittest.TestCase):
    def test_buy_records_fee_counter_price_levels(self):
        from market_collector.paper_trade import FEE_RATE
        portfolio = PaperPortfolio("test")
        quote = make_quote("159659", 1.5)
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
        quote = make_quote("159659", 1.5)
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
        return PaperEngine(Path(tmpdir))

    def test_history_records_nav_per_portfolio_and_market_spread(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            engine = self._engine(tmp)
            engine.tick(make_snapshot(PREMIUMS), now_ts=1000.0)
            engine.tick(make_snapshot(PREMIUMS), now_ts=1001.0)
            hist = engine.history(limit=10)
            self.assertEqual(len(hist["nav"]), 2)
            self.assertEqual(len(hist["spread"]), 2)
            # 净值序列按新组合 key 扩展；归档盘不再记录净值
            for key in ("quant-q01", "quant-q02", "quant-q03", "manual-q01"):
                self.assertIn(key, hist["nav"][0])
                self.assertIsInstance(hist["nav"][0][key], float)
            self.assertNotIn("quant", hist["nav"][0])
            self.assertNotIn("manual", hist["nav"][0])
            # spread 为全市场极差 = max − min（3.0 − 0.25）
            self.assertAlmostEqual(hist["spread"][0]["spread"], 2.75)
            self.assertEqual(hist["tick_seq"], 2)

    def test_status_exposes_universe_and_portfolio_specs(self):
        from market_collector.paper_trade import FEE_RATE, PORTFOLIO_SPECS
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            engine = self._engine(tmp)
            engine.tick(make_snapshot(PREMIUMS), now_ts=1000.0)
            status = engine.status()
            self.assertEqual(status["tick_seq"], 1)
            strategy = status["strategy"]
            self.assertEqual(strategy["symbols"], list(UNIVERSE))
            self.assertEqual(set(strategy["symbol_names"]), set(UNIVERSE))
            self.assertNotIn("symbol_x", strategy)
            self.assertNotIn("symbol_y", strategy)
            self.assertNotIn("q_threshold", strategy)
            self.assertNotIn("w_threshold", strategy)
            self.assertEqual(strategy["fee_rate"], FEE_RATE)
            self.assertEqual(
                strategy["portfolios"],
                [
                    {"key": spec["key"], "label": spec["label"], "q_threshold": spec.get("q"),
                     "delay_sec": spec["delay_sec"]}
                    for spec in PORTFOLIO_SPECS
                ],
            )
            # 6 只标的的盘口都在 quotes 里
            self.assertEqual(set(status["quotes"]), set(UNIVERSE))
            quote = status["quotes"]["159659"]
            self.assertEqual(len(quote["bids"]), 5)
            self.assertEqual(len(quote["asks"]), 5)
            self.assertIsNotNone(quote["quote_ts"])
            # 各组合状态带 q_threshold
            q01 = status["portfolios"]["quant-q01"]
            self.assertEqual(q01["q_threshold"], 0.1)
            self.assertNotIn("archived", q01)
            self.assertEqual(q01["exec_delay_sec"], 0)
            self.assertIn("total_fees", q01)
            self.assertIn("total_impact_cost", q01)
            self.assertIn("rotation_count", q01)
            self.assertNotIn("quant", status["portfolios"])
            self.assertNotIn("manual", status["portfolios"])
            manual_q01 = status["portfolios"]["manual-q01"]
            self.assertEqual(manual_q01["exec_delay_sec"], 3)

    def test_new_portfolios_start_fresh_and_legacy_state_ignored(self):
        # 新盘全新 100 万起步；旧 quant 状态文件存在也不再加载
        import json
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            legacy = {
                "name": "quant",
                "cash": 500000.0,
                "holdings": {"159659": 300000},
                "initial_capital": 1_000_000.0,
                "total_fees": 12.34,
                "total_impact_cost": 56.78,
                "rotation_count": 7,
            }
            (Path(tmp) / "portfolio-quant.json").write_text(json.dumps(legacy))
            engine = self._engine(tmp)
            self.assertNotIn("quant", engine.portfolios)
            # 新盘无历史状态，100 万起步
            for spec in ("quant-q01", "quant-q02", "quant-q03", "manual-q01"):
                entry = engine.portfolios[spec]
                self.assertEqual(entry["portfolio"].cash, 1_000_000.0)
                self.assertEqual(entry["portfolio"].holdings, {})
                self.assertNotIn("archived", entry)

    def test_history_survives_disk_snapshot(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            engine = self._engine(tmp)
            engine.tick(make_snapshot(PREMIUMS), now_ts=1000.0)
            engine.tick(make_snapshot(PREMIUMS), now_ts=1001.0)
            engine._save_snapshot_disk(force=True)
            engine2 = self._engine(tmp)
            self.assertEqual(engine2.tick_seq, 2)
            hist = engine2.history(limit=10)
            self.assertEqual(len(hist["nav"]), 2)
            self.assertEqual(len(hist["spread"]), 2)


if __name__ == "__main__":
    unittest.main()
