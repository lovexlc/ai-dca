import importlib.util
import pathlib
import sys
import unittest
from datetime import datetime
from zoneinfo import ZoneInfo


MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "quant_premium_runner.py"
SPEC = importlib.util.spec_from_file_location("quant_premium_runner", MODULE_PATH)
runner = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = runner
SPEC.loader.exec_module(runner)


def quote(code, premium, bid=1.5, ask=1.501, bid_size=50000, ask_size=50000):
    return runner.normalize_quote({
        "code": code,
        "name": code,
        "price": bid,
        "bid": bid,
        "ask": ask,
        "iopv": bid / (1 + premium / 100),
        "bidSize": bid_size,
        "askSize": ask_size,
    })


def config(bench="159513", cand="513100", bench_class="H", cand_class="L", max_daily=5, cooldown=0):
    return runner.normalize_config({
        "symbols": [
            {"code": bench, "name": bench, "class": bench_class},
            {"code": cand, "name": cand, "class": cand_class},
        ],
        "rules": [{
            "id": "r1",
            "name": "rule",
            "benchmark_codes": [bench],
            "enabled_codes": [cand],
            "intra_sell_lower_pct": 1,
            "intra_buy_other_pct": 3,
            "max_order_cash": 10000,
            "min_order_cash": 1000,
            "cooldown_sec": cooldown,
        }],
        "runtime": {
            "max_daily_triggers": max_daily,
        },
        "account": {
            "cash": 20000,
            "lot_size": 100,
            "fee_rate": 0,
            "min_fee": 0,
            "positions": {
                bench: {"shares": 10000, "cost_price": 1.4},
                cand: {"shares": 1000, "cost_price": 1.3},
            },
        },
    })


class QuantPremiumRunnerTest(unittest.TestCase):
    def test_h_benchmark_triggers_rule_b_when_gap_expands(self):
        cfg = config(bench_class="H", cand_class="L")
        rows = runner.evaluate_rules(cfg, {
            "159513": quote("159513", 5),
            "513100": quote("513100", 1),
        })

        self.assertEqual(rows[0]["kind"], "B")
        self.assertTrue(rows[0]["triggered"])
        self.assertEqual(rows[0]["from_code"], "159513")
        self.assertEqual(rows[0]["to_code"], "513100")
        self.assertAlmostEqual(rows[0]["gap_pct"], 4.0)

    def test_l_benchmark_triggers_rule_a_when_gap_contracts(self):
        cfg = config(bench="513100", cand="159513", bench_class="L", cand_class="H")
        rows = runner.evaluate_rules(cfg, {
            "513100": quote("513100", 1.2),
            "159513": quote("159513", 1.8),
        })

        self.assertEqual(rows[0]["kind"], "A")
        self.assertTrue(rows[0]["triggered"])
        self.assertAlmostEqual(rows[0]["gap_pct"], 0.6)

    def test_missing_class_or_premium_does_not_trigger(self):
        cfg = config(bench_class="H", cand_class="")
        rows = runner.evaluate_rules(cfg, {
            "159513": quote("159513", 5),
            "513100": runner.normalize_quote({"code": "513100", "price": 1.5}),
        })

        self.assertEqual(rows[0]["kind"], "none")
        self.assertFalse(rows[0]["triggered"])
        self.assertEqual(rows[0]["reason"], "missing_class")

    def test_run_tick_writes_simulated_orders_and_updates_state(self):
        cfg = config(bench_class="H", cand_class="L")
        state = runner.initial_state(cfg)
        before_cash = state["cash"]
        before_sell_shares = state["positions"]["159513"]["shares"]
        result = runner.run_tick(cfg, state, {
            "159513": quote("159513", 5, bid=1.8, ask=1.801),
            "513100": quote("513100", 1, bid=1.5, ask=1.501),
        }, datetime(2026, 6, 12, 10, 0, tzinfo=ZoneInfo("Asia/Shanghai")))

        self.assertEqual(len(result["orders"]), 2)
        self.assertLess(state["positions"]["159513"]["shares"], before_sell_shares)
        self.assertGreater(state["positions"]["513100"]["shares"], 1000)
        self.assertNotEqual(state["cash"], before_cash)
        self.assertEqual(state["daily"]["trigger_count"], 1)

    def test_daily_limit_and_cooldown_skip_repeated_trigger(self):
        cfg = config(bench_class="H", cand_class="L", max_daily=1, cooldown=0)
        state = runner.initial_state(cfg)
        quotes = {
            "159513": quote("159513", 5, bid=1.8, ask=1.801),
            "513100": quote("513100", 1, bid=1.5, ask=1.501),
        }

        first = runner.run_tick(cfg, state, quotes, datetime(2026, 6, 12, 10, 0, tzinfo=ZoneInfo("Asia/Shanghai")))
        second = runner.run_tick(cfg, state, quotes, datetime(2026, 6, 12, 10, 1, tzinfo=ZoneInfo("Asia/Shanghai")))

        self.assertEqual(len(first["orders"]), 2)
        self.assertEqual(len(second["orders"]), 0)
        self.assertEqual(second["skipped"][0]["skip_reason"], "daily_limit")


if __name__ == "__main__":
    unittest.main()
