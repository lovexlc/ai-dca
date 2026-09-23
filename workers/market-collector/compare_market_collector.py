#!/usr/bin/env python3
"""
A/B 对比脚本：cn 机器 fund_collector vs 新 market-collector worker
在本机运行（需要能访问 cn.freebacktrack.tech:5000）。

用法：
    python3 compare_market_collector.py
    python3 compare_market_collector.py --codes 513100,159509,161128
    python3 compare_market_collector.py --worker-url https://xxx.workers.dev

对比维度（每只基金）：
    - price / iopv / premium  数值差异
    - quality 状态
    - 数据新鲜度（collected_at 距现在）
    - 字段齐备性
"""
import argparse
import json
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

CN_BASE = "https://cn.freebacktrack.tech:5000/api/market-collector"
WORKER_BASE = "https://api.freebacktrack.tech/api/mc"

DEFAULT_CODES = [
    "513870", "513390", "513300", "513110", "513100", "159941", "159696",
    "159660", "159659", "159632", "159513", "159509", "159501", "159577",
    "161125", "161128", "161130", "513500", "513650", "159612", "159655",
    "513850", "563020",
]

PRICE_TOL = 0.005      # 价格容差（绝对值）
PREMIUM_TOL_PP = 0.1   # 溢价容差（百分点）


def fetch_json(url, payload=None, timeout=30):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url, data=data, method="POST" if data else "GET",
        headers={"Content-Type": "application/json", "User-Agent": "mc-compare/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, {"_http_error": e.code}
    except Exception as e:
        return 0, {"_fetch_error": str(e)[:200]}


def get_cn_metrics(cn_base, codes):
    # 先探活
    status, health = fetch_json(f"{cn_base}/health", timeout=15)
    print(f"[cn] health: http={status} " + (
        f"ok" if status == 200 and not health.get("_fetch_error") else f"FAIL {health}"))
    if status != 200:
        return None
    # 取行情：优先 POST {codes}，失败则回退 GET
    status, data = fetch_json(f"{cn_base}/fund-metrics", {"codes": codes})
    if status != 200 or not data.get("items"):
        status, data = fetch_json(
            f"{cn_base}/fund-metrics?codes={','.join(codes)}")
    if status != 200:
        print(f"[cn] fund-metrics FAIL: http={status} {str(data)[:200]}")
        return None
    items = data.get("items") or []
    print(f"[cn] fund-metrics ok: {len(items)} items, "
          f"generatedAt={data.get('generatedAt') or data.get('generated_at')}")
    return {str(i.get("code") or i.get("symbol")): i for i in items}


def get_worker_metrics(base, codes):
    status, health = fetch_json(f"{base}/health", timeout=15)
    print(f"[worker] health: http={status} " + (
        "ok" if status == 200 and not health.get("_fetch_error") else f"FAIL {health}"))
    if status != 200:
        return None
    status, data = fetch_json(f"{base}/fund-metrics", {"codes": codes})
    if status != 200:
        print(f"[worker] fund-metrics FAIL: http={status} {str(data)[:200]}")
        return None
    items = data.get("items") or []
    print(f"[worker] fund-metrics ok: {len(items)} items, "
          f"generatedAt={data.get('generatedAt')}")
    return {str(i.get("code")): i for i in items}


def pick(d, *keys):
    for k in keys:
        if d.get(k) is not None:
            return d.get(k)
    return None


def parse_ts(v):
    if not v:
        return None
    try:
        s = str(v).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def age_str(v):
    dt = parse_ts(v)
    if not dt:
        return "?"
    secs = (datetime.now(timezone.utc) - dt).total_seconds()
    if secs < 0:
        return "future?"
    if secs < 90:
        return f"{int(secs)}s"
    return f"{int(secs // 60)}m"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--codes", default=",".join(DEFAULT_CODES))
    ap.add_argument("--worker-url", default=WORKER_BASE)
    ap.add_argument("--cn-url", default=CN_BASE)
    args = ap.parse_args()
    codes = [c.strip() for c in args.codes.split(",") if c.strip()]
    cn_base = args.cn_url.rstrip("/")
    worker_base = args.worker_url.rstrip("/")

    print("=" * 78)
    print(f"codes: {len(codes)}  cn={cn_base}  worker={worker_base}")
    print("=" * 78)

    cn = get_cn_metrics(cn_base, codes)
    worker = get_worker_metrics(worker_base, codes)
    if cn is None or worker is None:
        print("\n!! 某一方不可达，对比中止。请检查网络/URL。")
        sys.exit(2)

    print("\n" + "=" * 78)
    print(f"{'code':<8} {'price cn→wk':<22} {'iopv cn→wk':<22} {'premium% cn→wk':<22} {'q'}")
    print("-" * 78)

    n_ok = n_warn = n_missing = 0
    for code in codes:
        c, w = cn.get(code), worker.get(code)
        if c is None or w is None:
            n_missing += 1
            print(f"{code:<8} {'cn缺失' if c is None else ''} {'worker缺失' if w is None else ''}  ✗")
            continue

        cp = pick(c, "price"); wp = w.get("price")
        ci = pick(c, "iopv"); wi = w.get("iopv")
        cprem = pick(c, "premiumPercent", "premium_percent", "computed_premium_percent")
        wprem = w.get("computed_premium_percent")
        cq = pick(c, "quality", "status"); wq = w.get("quality", {}).get("status")

        flags = []
        if cp is not None and wp is not None and abs(cp - wp) > PRICE_TOL:
            flags.append(f"price差{abs(cp-wp):.4f}")
        if ci is not None and wi is not None and abs(ci - wi) > 0.002:
            flags.append(f"iopv差{abs(ci-wi):.4f}")
        if cprem is not None and wprem is not None and abs(cprem - wprem) > PREMIUM_TOL_PP:
            flags.append(f"溢价差{abs(cprem-wprem):.2f}pp")

        mark = "✓" if not flags else "⚠"
        if flags:
            n_warn += 1
        else:
            n_ok += 1
        cps = f"{cp}" if cp is not None else "-"
        wps = f"{wp}" if wp is not None else "-"
        cis = f"{ci}" if ci is not None else "-"
        wis = f"{wi}" if wi is not None else "-"
        cprs = f"{cprem:.2f}" if isinstance(cprem, (int, float)) else "-"
        wprs = f"{wprem:.2f}" if isinstance(wprem, (int, float)) else "-"
        print(f"{code:<8} {cps:>8}→{wps:<8} {cis:>8}→{wis:<8} {cprs:>8}→{wprs:<8} "
              f"{cq or '?'}/{wq or '?'} {mark} {' '.join(flags)}")

    # 新鲜度
    print("\n--- 新鲜度 ---")
    for name, data in (("cn", cn), ("worker", worker)):
        ages = [age_str(pick(i, "asOf", "collected_at", "collectedAt"))
                for i in data.values()]
        print(f"{name}: asOf距今 {', '.join(ages[:5])}{'...' if len(ages) > 5 else ''}")

    print("\n" + "=" * 78)
    print(f"一致 ✓: {n_ok}   差异 ⚠: {n_warn}   缺失 ✗: {n_missing}")
    if n_warn == 0 and n_missing == 0:
        print("结论：两边数据一致，worker 可接管。")
    elif n_missing:
        print("结论：有缺失项，先排查缺失原因再切换。")
    else:
        print("结论：有数值差异，检查 diff 列判断是否在容差内。")


if __name__ == "__main__":
    main()
