"""网络出口助手：数据源直连优先，失败时经机器级出口代理重试。

背景（2026-09-22 实测）：
- 东财 push2delay（延迟镜像）对所有客户端不可达；实时端点 push2 的 ulist.np 可用；
- 东财对数据中心 IP 段做 IP 级拦截：本机直连（urllib/curl 均验证）对 push2 全部被 RST；
- 机器级出口代理 ga.dp.tech:8118 是轮换出口 IP 池，单次请求约一半概率落在未被封的
  出口 IP 上，因此代理层需要重试（3 次累计成功率约 87%）。

策略：
- 一律先直连（IP 级封锁若解除可自动恢复直连）；
- 仅当目标域在 PROXY_FALLBACK_HOSTS 内（东财/蛋卷）且直连抛错时，经出口代理重试至多
  PROXY_RETRY_ATTEMPTS 次；
- 其余域（腾讯/新浪/SEC 等）直连失败直接抛错，绝不引入新依赖。
"""
from __future__ import annotations

import os
import urllib.request

DEFAULT_EGRESS_PROXY = "http://ga.dp.tech:8118"
PROXY_FALLBACK_HOSTS = ("eastmoney.com", "danjuanfunds.com")
PROXY_RETRY_ATTEMPTS = 5

DEFAULT_HEADERS = {
    "accept": "application/json",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
}


def egress_proxy() -> str:
    return os.environ.get("MARKET_COLLECTOR_EGRESS_PROXY") or DEFAULT_EGRESS_PROXY


def proxy_fallback_enabled(url: str) -> bool:
    lowered = str(url or "").lower()
    return any(host in lowered for host in PROXY_FALLBACK_HOSTS)


def _open_direct(request: urllib.request.Request, timeout_sec: float) -> bytes:
    with urllib.request.urlopen(request, timeout=timeout_sec) as response:
        return response.read()


def _open_via_proxy(request: urllib.request.Request, timeout_sec: float) -> bytes:
    proxy_url = egress_proxy()
    if not proxy_url:
        raise OSError("egress proxy disabled")
    handler = urllib.request.ProxyHandler({"http": proxy_url, "https": proxy_url})
    opener = urllib.request.build_opener(handler)
    with opener.open(request, timeout=timeout_sec) as response:
        return response.read()


def fetch_url(
    url: str,
    timeout_sec: float,
    headers: dict[str, str] | None = None,
) -> bytes:
    request = urllib.request.Request(url, headers={**DEFAULT_HEADERS, **(headers or {})})
    try:
        return _open_direct(request, timeout_sec)
    except Exception:
        if not proxy_fallback_enabled(url):
            raise
    # 代理是轮换出口 IP 池，单次失败多半只是抽到了被封的出口 IP，重试几次即可命中。
    last_error: Exception | None = None
    for _ in range(PROXY_RETRY_ATTEMPTS):
        try:
            return _open_via_proxy(request, timeout_sec)
        except Exception as exc:
            last_error = exc
    raise last_error or RuntimeError("proxy fetch failed")
