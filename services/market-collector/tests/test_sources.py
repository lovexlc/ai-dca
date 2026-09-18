from __future__ import annotations

import unittest

from market_collector.sources import parse_eastmoney_list_payload, parse_tencent_quote_text


class SourceParserTest(unittest.TestCase):
    def test_parse_tencent_batch_quote(self) -> None:
        payload = 'v_sh513100="1~纳指ETF国泰~513100~2.236~2.261~2.250~571425~12769~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~20260811145501~-0.025~-1.11~2.260~2.220";'
        result = parse_tencent_quote_text(payload, "2026-08-11T10:00:00+08:00")

        self.assertEqual(result["513100"]["symbol"], "513100")
        self.assertEqual(result["513100"]["price"], 2.236)
        self.assertEqual(result["513100"]["open"], 2.25)
        self.assertEqual(result["513100"]["volume"], 571425)
        self.assertEqual(result["513100"]["source"], "tencent_batch")
        self.assertEqual(result["513100"]["source_as_of"], "2026-08-11T14:55:01+08:00")

    def test_parse_eastmoney_sign_corrects_vendor_premium(self) -> None:
        payload = {
            "data": {
                "diff": [
                    {
                        "f12": "513100", "f14": "纳指ETF国泰", "f2": 2.237,
                        "f3": -1.11, "f4": -0.025, "f5": 571425, "f6": 1276900,
                        "f8": 0.12, "f15": 2.26, "f16": 2.22, "f17": 2.25, "f18": 2.261,
                        "f20": 21234567890, "f124": 1723447200, "f402": -11.58, "f441": 2.0048,
                        "f38": 9477110528.0,
                    }
                ]
            }
        }
        result = parse_eastmoney_list_payload(payload, "2026-08-11T10:00:01+08:00", page=24)

        self.assertEqual(result["513100"]["iopv"], 2.0048)
        self.assertEqual(result["513100"]["previous_close"], 2.261)
        self.assertEqual(result["513100"]["change"], -0.025)
        self.assertEqual(result["513100"]["change_percent"], -1.11)
        self.assertEqual(result["513100"]["volume"], 571425.0)
        self.assertEqual(result["513100"]["turnover"], 1276900.0)
        self.assertEqual(result["513100"]["market_capital"], 21234567890.0)
        self.assertEqual(result["513100"]["vendor_discount_percent_raw"], -11.58)
        self.assertEqual(result["513100"]["vendor_premium_percent"], 11.58)
        self.assertEqual(result["513100"]["total_shares"], 9477110528.0)
        self.assertEqual(result["513100"]["page"], 24)
        self.assertEqual(result["513100"]["source_as_of"], "2024-08-12T15:20:00+08:00")

    def test_parse_eastmoney_falls_back_to_total_share_field(self) -> None:
        payload = {"data": {"diff": [{"f12": "159501", "f2": 2.1, "f39": 6780986624}]}}
        result = parse_eastmoney_list_payload(payload, "2026-08-11T10:00:01+08:00", page=1)
        self.assertEqual(result["159501"]["total_shares"], 6780986624.0)


if __name__ == "__main__":
    unittest.main()
