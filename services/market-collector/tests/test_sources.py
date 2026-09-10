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
                    {"f12": "513100", "f14": "纳指ETF国泰", "f2": 2.237, "f124": 1723447200, "f402": -11.58, "f441": 2.0048}
                ]
            }
        }
        result = parse_eastmoney_list_payload(payload, "2026-08-11T10:00:01+08:00", page=24)

        self.assertEqual(result["513100"]["iopv"], 2.0048)
        self.assertEqual(result["513100"]["vendor_discount_percent_raw"], -11.58)
        self.assertEqual(result["513100"]["vendor_premium_percent"], 11.58)
        self.assertEqual(result["513100"]["page"], 24)
        self.assertEqual(result["513100"]["source_as_of"], "2024-08-12T15:20:00+08:00")


if __name__ == "__main__":
    unittest.main()
