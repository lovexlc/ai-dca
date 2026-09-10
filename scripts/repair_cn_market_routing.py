from pathlib import Path

# This script is temporary migration tooling for PR #68. It restores the collector
# sources from the pre-placeholder commit and removes Cloudflare market fallbacks.

AGG = Path('services/market-collector/market_collector/aggregates.py')
HTTP = Path('services/market-collector/market_collector/http_server.py')
OTC = Path('services/market-collector/market_collector/otc.py')

s = AGG.read_text()
s = s.replace('import math\n', 'import math\nimport re\n')
s = s.replace(
    'NAV_HISTORY_URL = "https://api.freebacktrack.tech/api/holdings/nav-history"\n'
    'MARKETS_KLINE_URL = "https://api.freebacktrack.tech/api/markets/kline"\n',
    'DANJUAN_NAV_HISTORY_URL = "https://danjuanfunds.com/djapi/fund/nav/history/{code}"\n',
)
helper = '''\n\ndef _fetch_danjuan_nav_history(code: str, from_date: str, to_date: str, timeout_sec: float) -> list[dict[str, Any]]:\n    normalized = str(code or "").strip()\n    if not re.fullmatch(r"\\d{6}", normalized):\n        raise ValueError("invalid fund code")\n    items: list[dict[str, Any]] = []\n    page_size = 100\n    for page in range(1, 51):\n        params = urllib.parse.urlencode({"page": page, "size": page_size})\n        request = urllib.request.Request(\n            DANJUAN_NAV_HISTORY_URL.format(code=urllib.parse.quote(normalized)) + "?" + params,\n            headers={\n                "accept": "application/json, text/plain, */*",\n                "referer": "https://danjuanfunds.com/",\n                "user-agent": "Mozilla/5.0 market-collector/1",\n            },\n        )\n        with urllib.request.urlopen(request, timeout=timeout_sec) as response:\n            payload = json.loads(response.read().decode("utf-8", "replace"))\n        rows = ((payload.get("data") or {}).get("items")) or []\n        if not rows:\n            break\n        reached_before_range = False\n        for row in rows:\n            nav_date = str(row.get("date") or "")[:10]\n            nav = _number(row.get("nav", row.get("value")))\n            if not re.fullmatch(r"\\d{4}-\\d{2}-\\d{2}", nav_date):\n                continue\n            if nav_date < from_date:\n                reached_before_range = True\n                continue\n            if nav_date > to_date or nav is None or nav <= 0:\n                continue\n            items.append({"date": nav_date, "nav": _round4(nav)})\n        total = int((payload.get("data") or {}).get("total_items") or 0)\n        if reached_before_range or (total > 0 and page * page_size >= total):\n            break\n    dedup = {item["date"]: item for item in items}\n    return [dedup[key] for key in sorted(dedup)]\n'''
if 'def _fetch_danjuan_nav_history' not in s:
    s = s[:s.index('\ndef _shanghai_iso')] + helper + s[s.index('\ndef _shanghai_iso'):]
old = '''        def load_navs() -> dict[str, list[dict[str, Any]]]:\n            payload = self.post_json(NAV_HISTORY_URL, {\n                "codes": codes, "from": start.isoformat(), "to": today.isoformat(),\n            }, self.timeout_sec)\n            result: dict[str, list[dict[str, Any]]] = {}\n            for entry in payload.get("items") or []:\n                code = str(entry.get("code") or "")\n                rows = ((entry.get("data") or {}).get("items")) or []\n                valid = [\n                    {"date": str(row.get("date") or "")[:10], "nav": _round4(row.get("nav"))}\n                    for row in rows if _number(row.get("nav")) is not None and _number(row.get("nav")) > 0\n                ]\n                result[code] = valid\n            return result\n'''
new = '''        def load_navs() -> dict[str, list[dict[str, Any]]]:\n            result: dict[str, list[dict[str, Any]]] = {}\n            missing = [code for code in codes if not (metrics.get(code) or {}).get("latestNav")]\n            if not missing:\n                return result\n            with ThreadPoolExecutor(max_workers=min(6, len(missing))) as executor:\n                futures = {\n                    executor.submit(_fetch_danjuan_nav_history, code, start.isoformat(), today.isoformat(), self.timeout_sec): code\n                    for code in missing\n                }\n                for future, code in ((future, futures[future]) for future in futures):\n                    try:\n                        result[code] = future.result()\n                    except Exception:\n                        result[code] = []\n            return result\n'''
if old not in s:
    raise SystemExit('aggregates nav block changed')
s = s.replace(old, new)
old = '''        def load() -> dict[str, Any]:\n            fallback_params = urllib.parse.urlencode({"tf": "1d", "limit": limit})\n            try:\n                fallback = self.fetch_json(f"{MARKETS_KLINE_URL}/{symbol}?{fallback_params}", self.timeout_sec)\n                rows = []\n                for item in fallback.get("candles") or []:\n                    candle_date = str(item.get("date") or datetime.fromtimestamp(float(item.get("t") or 0), SHANGHAI).date().isoformat())[:10]\n                    rows.append(",".join(str(value if value is not None else "") for value in [\n                        candle_date, item.get("o"), item.get("c"), item.get("h"), item.get("l"),\n                        item.get("v"), item.get("amount"), item.get("amplitudePercent"),\n                        item.get("changePercent"), item.get("change"), item.get("turnoverRate"),\n                    ]))\n                raw = {"data": {"name": fallback.get("name") or symbol, "klines": rows}}\n                source = "markets-worker"\n            except Exception:\n                raw = self.fetch_json(EASTMONEY_KLINE_URL + "?" + params, min(self.timeout_sec, 3.0))\n                source = "eastmoney-push2his-fallback"\n'''
new = '''        def load() -> dict[str, Any]:\n            raw = self.fetch_json(EASTMONEY_KLINE_URL + "?" + params, self.timeout_sec)\n            source = "eastmoney-push2his"\n'''
if old not in s:
    raise SystemExit('aggregates kline block changed')
s = s.replace(old, new)
old = '''        params = urllib.parse.urlencode({"code": symbol, "from": from_date.isoformat(), "to": to_date.isoformat()})\n\n        def load() -> dict[str, Any]:\n            payload = self.fetch_json(NAV_HISTORY_URL + "?" + params, self.timeout_sec)\n            items = []\n            for item in payload.get("items") or []:\n                nav_date = str(item.get("date") or "")[:10]\n                nav = _number(item.get("nav"))\n                if nav_date and nav is not None and nav > 0:\n                    items.append({"date": nav_date, "t": _date_epoch(nav_date), "nav": _round4(nav)})\n            return {\n                "symbol": symbol, "from": from_date.isoformat(), "to": to_date.isoformat(),\n                "generatedAt": payload.get("generatedAt") or _shanghai_iso(datetime.now(timezone.utc)),\n                "source": "holdings-nav-history", "items": items,\n            }\n'''
new = '''        def load() -> dict[str, Any]:\n            rows = _fetch_danjuan_nav_history(symbol, from_date.isoformat(), to_date.isoformat(), self.timeout_sec)\n            items = [{"date": item["date"], "t": _date_epoch(item["date"]), "nav": item["nav"]} for item in rows]\n            return {\n                "symbol": symbol, "from": from_date.isoformat(), "to": to_date.isoformat(),\n                "generatedAt": _shanghai_iso(datetime.now(timezone.utc)),\n                "source": "danjuan-nav-history", "items": items,\n            }\n'''
if old not in s:
    raise SystemExit('aggregates history block changed')
s = s.replace(old, new)
AGG.write_text(s)

s = OTC.read_text().replace(
    'FUND_METRICS_URL = "https://api.freebacktrack.tech/api/markets/fund-metrics"',
    'FUND_METRICS_URL = "http://127.0.0.1:18080/fund-metrics"',
)
OTC.write_text(s)

s = HTTP.read_text()
s = s.replace('UPSTREAM_API_BASE = "https://api.freebacktrack.tech/api"\nUPSTREAM_MARKETS_BASE = "https://api.freebacktrack.tech/api/markets"\n', '')
s = s.replace(
    'def _normalize_web_route(path: str) -> str:\n    for prefix in ("/api/market-collector", "/api/markets"):','def _normalize_web_route(path: str) -> str:\n    if path == "/api/holdings/nav-history":\n        return "/nav-history"\n    for prefix in ("/api/market-collector", "/api/markets"):'
)
s = s.replace('    "/list-rows", "/exchange-fund-list",\n}', '    "/list-rows", "/exchange-fund-list", "/nav-history",\n}')
start = s.index('def _upstream_target(')
end = s.index('\ndef _fetch_sec_json', start)
s = s[:start] + '''def proxy_market_request(\n    method: str, path: str, body: dict[str, Any] | None, timeout_sec: float = 25.0,\n) -> tuple[int, dict[str, Any]]:\n    route = _normalize_web_route(urlparse(path).path.rstrip("/") or "/")\n    return HTTPStatus.NOT_IMPLEMENTED, {\n        "error": "collector_market_route_missing",\n        "path": route,\n        "detail": "Market routes must be implemented by the CN market collector.",\n    }\n\n''' + s[end + 1:]
old = '''        local = _local_quote(data_service, match.group("symbol"))\n        if offline and local is not None:\n            return HTTPStatus.OK, local\n        if offline:\n            return HTTPStatus.NOT_FOUND, {"error": "symbol_not_found", "symbol": match.group("symbol")}\n        upstream_status, upstream = proxy_request(\n            method,\n            route + (("?" + parsed.query) if parsed.query else ""),\n            None,\n        )\n        if local:\n            return HTTPStatus.OK, _merge_fresh_record(\n                upstream if upstream_status == HTTPStatus.OK else {},\n                local,\n            )\n        return upstream_status, upstream\n'''
new = '''        local = _local_quote(data_service, match.group("symbol"))\n        if local is not None:\n            return HTTPStatus.OK, local\n        return HTTPStatus.NOT_FOUND, {"error": "symbol_not_found", "symbol": match.group("symbol")}\n'''
if old not in s:
    raise SystemExit('quote proxy block changed')
s = s.replace(old, new)
qstart = s.index('    if route == "/quotes" and data_service and method == "GET":')
qend = s.index('\n    match = WEB_KLINE_PATH.fullmatch(route)', qstart)
s = s[:qstart] + '''    if route == "/quotes" and data_service and method == "GET":\n        requested = list(dict.fromkeys(\n            code for raw in query.get("symbols", [])\n            for code in re.split(r"[,\\s]+", str(raw)) if code\n        ))[:100]\n        local_quotes = {}\n        for symbol in requested:\n            local = _local_quote(data_service, symbol)\n            if local is not None:\n                local_quotes[symbol] = local\n        return HTTPStatus.OK, {\n            "quotes": local_quotes,\n            "generatedAt": max((str(item.get("asOf") or "") for item in local_quotes.values()), default=""),\n            "source": "market-collector",\n        }\n''' + s[qend:]
kstart = s.index('    match = WEB_KLINE_PATH.fullmatch(route)')
kend = s.index('\n    if route == "/fund-metrics" and data_service and method == "POST":', kstart)
kblock = s[kstart:kend]
idx = kblock.rfind('        return proxy_request(')
if idx >= 0:
    kblock = kblock[:idx] + '        return HTTPStatus.NOT_FOUND, {"error": "symbol_not_found", "symbol": match.group("symbol")}\n'
s = s[:kstart] + kblock + s[kend:]
pstart = s.index('    if route == "/fund-metrics" and data_service and method == "POST":')
pend = s.index('\n    if route == "/fund-metrics" and data_service:', pstart + 10)
post = '''    if route == "/fund-metrics" and data_service and method == "POST":\n        codes = list(dict.fromkeys(str(code or "").strip() for code in (body or {}).get("codes") or [] if re.fullmatch(r"\\d{6}", str(code or "").strip())))[:100]\n        if not codes:\n            return HTTPStatus.BAD_REQUEST, {"error": "codes_required"}\n        try:\n            items = [item for item in data_service.fund_metrics(codes) if isinstance(item, dict)]\n        except Exception as exc:\n            return HTTPStatus.SERVICE_UNAVAILABLE, {"error": "local_fund_metrics_failed", "detail": str(exc)}\n        return HTTPStatus.OK, {"items": items, "successCount": len(items), "failureCount": len(codes) - len(items), "source": "market-collector"}\n'''
s = s[:pstart] + post + s[pend:]
anchor = '    if route == "/fund-metrics" and data_service and method == "POST":\n'
nav = '''    if route == "/nav-history" and data_service:\n        if method == "GET":\n            code = str((query.get("code") or [""])[0]).strip()\n            if not re.fullmatch(r"\\d{6}", code):\n                return HTTPStatus.BAD_REQUEST, {"error": "code_required"}\n            try:\n                return HTTPStatus.OK, data_service.nav_history(code, _int_param(query, "days", 365, 3650))\n            except Exception as exc:\n                return HTTPStatus.BAD_GATEWAY, {"error": "nav_history_failed", "detail": str(exc)}\n        if method == "POST":\n            codes = list(dict.fromkeys(str(code or "").strip() for code in (body or {}).get("codes") or [] if re.fullmatch(r"\\d{6}", str(code or "").strip())))[:60]\n            if not codes:\n                return HTTPStatus.BAD_REQUEST, {"error": "codes_required"}\n            items = []\n            for code in codes:\n                try:\n                    items.append({"code": code, "ok": True, "data": data_service.nav_history(code, 1000)})\n                except Exception as exc:\n                    items.append({"code": code, "ok": False, "error": str(exc)})\n            return HTTPStatus.OK, {"ok": True, "count": len(items), "items": items, "source": "market-collector"}\n        return HTTPStatus.METHOD_NOT_ALLOWED, {"error": "method_not_allowed"}\n\n'''
s = s.replace(anchor, nav + anchor, 1)
old = '''        except (HTTPError, OSError, TimeoutError, ValueError, json.JSONDecodeError):\n            return proxy_request(\n                method,\n                route + (("?" + parsed.query) if parsed.query else ""),\n                None,\n            )\n\n    if _is_web_api_route(route):\n        return proxy_request(\n            method,\n            route + (("?" + parsed.query) if parsed.query else ""),\n            body,\n        )\n'''
new = '''        except (HTTPError, OSError, TimeoutError, ValueError, json.JSONDecodeError) as exc:\n            return HTTPStatus.BAD_GATEWAY, {"error": "financials_source_failed", "detail": str(exc)}\n\n    if route == "/market-summary" and data_service and method == "GET":\n        region = str((query.get("region") or query.get("market") or ["US"])[0]).upper()\n        payload = data_service.market_summary(region)\n        return (HTTPStatus.OK, payload) if payload is not None else (HTTPStatus.BAD_REQUEST, {"error": "unsupported_market"})\n    if route == "/indices" and data_service and method == "GET":\n        region = str((query.get("market") or query.get("region") or ["US"])[0]).upper()\n        payload = data_service.market_summary(region) or {"items": []}\n        return HTTPStatus.OK, {**payload, "source": "market-collector"}\n    if route == "/summary" and data_service and method == "GET":\n        return HTTPStatus.OK, data_service.home_overview()\n    if route in {"/sectors", "/news", "/earnings", "/taco", "/list-rows", "/exchange-fund-list"}:\n        return HTTPStatus.OK, {"items": [], "source": "market-collector", "capability": "local-empty"}\n    if _is_web_api_route(route):\n        return HTTPStatus.NOT_IMPLEMENTED, {"error": "collector_market_route_missing", "path": route, "detail": "Add this market capability to services/market-collector."}\n'''
if old not in s:
    raise SystemExit('bottom proxy block changed')
s = s.replace(old, new)
s = s.replace('"web compatibility proxy: indices, sectors, search, summary, news, earnings, financials, xueqiu-fund-data",', '"web compatibility routes are collector-local; no Cloudflare market fallback",')
HTTP.write_text(s)
