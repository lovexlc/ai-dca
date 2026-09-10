from pathlib import Path

agg = Path('services/market-collector/market_collector/aggregates.py')
s = agg.read_text()
s = s.replace(
    'def _fetch_danjuan_nav_history(code: str, from_date: str, to_date: str, timeout_sec: float) -> list[dict[str, Any]]:',
    'def _fetch_danjuan_nav_history(code: str, from_date: str, to_date: str, timeout_sec: float, fetch_json: FetchJson = _fetch_json) -> list[dict[str, Any]]:'
)
old = '''        request = urllib.request.Request(\n            DANJUAN_NAV_HISTORY_URL.format(code=urllib.parse.quote(normalized)) + "?" + params,\n            headers={\n                "accept": "application/json, text/plain, */*",\n                "referer": "https://danjuanfunds.com/",\n                "user-agent": "Mozilla/5.0 market-collector/1",\n            },\n        )\n        with urllib.request.urlopen(request, timeout=timeout_sec) as response:\n            payload = json.loads(response.read().decode("utf-8", "replace"))\n        rows = ((payload.get("data") or {}).get("items")) or []\n'''
new = '''        url = DANJUAN_NAV_HISTORY_URL.format(code=urllib.parse.quote(normalized)) + "?" + params\n        payload = fetch_json(url, timeout_sec)\n        rows = ((payload.get("data") or {}).get("items")) or payload.get("items") or []\n'''
if old not in s:
    raise SystemExit('danjuan fetch block changed')
s = s.replace(old, new)
s = s.replace(
    'executor.submit(_fetch_danjuan_nav_history, code, start.isoformat(), today.isoformat(), self.timeout_sec): code',
    'executor.submit(_fetch_danjuan_nav_history, code, start.isoformat(), today.isoformat(), self.timeout_sec, self.fetch_json): code'
)
s = s.replace(
    'rows = _fetch_danjuan_nav_history(symbol, from_date.isoformat(), to_date.isoformat(), self.timeout_sec)',
    'rows = _fetch_danjuan_nav_history(symbol, from_date.isoformat(), to_date.isoformat(), self.timeout_sec, self.fetch_json)'
)
old = '''        elif dataset == "fund-fee" and key.isdigit():\n            refs = self.store.read_latest_fund_references("fund_fee", [key])\n            payload = refs.get(key)\n        elif dataset == "fund-limit-overview" and key == "global":\n'''
new = '''        elif dataset == "fund-fee" and key.isdigit():\n            refs = self.store.read_latest_fund_references("fund_fee", [key])\n            payload = refs.get(key)\n        elif dataset == "fund-limit" and key.isdigit():\n            refs = self.store.read_latest_fund_references("fund_limit", [key])\n            payload = refs.get(key)\n        elif dataset == "fund-limit-overview" and key == "global":\n'''
if old not in s:
    raise SystemExit('dataset fund fee block changed')
s = s.replace(old, new)
agg.write_text(s)

core = Path('services/market-collector/market_collector/core.py')
s = core.read_text()
s = s.replace('"fund_reference_sync": {\n        "enabled": False,', '"fund_reference_sync": {\n        "enabled": True,')
core.write_text(s)

http = Path('services/market-collector/market_collector/http_server.py')
s = http.read_text()
s = s.replace(
    '    "/earnings", "/fund-metrics", "/fund-fee", "/market-summary", "/taco", "/movers",',
    '    "/earnings", "/fund-metrics", "/fund-fee", "/fund-limit", "/fund-limit/overview", "/market-summary", "/taco", "/movers",'
)
anchor = '''    if route == "/aggregates/home-market-overview" and data_service:\n        return HTTPStatus.OK, data_service.home_overview()\n'''
routes = '''    if route == "/fund-fee" and data_service:\n        if method == "GET":\n            code = str((query.get("code") or query.get("symbol") or [""])[0]).strip()\n            if not re.fullmatch(r"\\d{6}", code):\n                return HTTPStatus.BAD_REQUEST, {"error": "code_required"}\n            record = data_service.dataset_record("fund-fee", code)\n            if record is None:\n                return HTTPStatus.NOT_FOUND, {"error": "fund_fee_not_found", "code": code}\n            return HTTPStatus.OK, record.get("payload") or record\n        if method == "POST":\n            codes = list(dict.fromkeys(str(code or "").strip() for code in (body or {}).get("codes") or [] if re.fullmatch(r"\\d{6}", str(code or "").strip())))[:100]\n            if not codes:\n                return HTTPStatus.BAD_REQUEST, {"error": "codes_required"}\n            items = []\n            for code in codes:\n                record = data_service.dataset_record("fund-fee", code)\n                if record is None:\n                    items.append({"code": code, "ok": False, "error": "fund_fee_not_found"})\n                else:\n                    items.append({"code": code, "ok": True, "data": record.get("payload") or record})\n            return HTTPStatus.OK, {"items": items, "successCount": sum(1 for item in items if item["ok"]), "failureCount": sum(1 for item in items if not item["ok"]), "source": "market-collector"}\n        return HTTPStatus.METHOD_NOT_ALLOWED, {"error": "method_not_allowed"}\n\n    if route == "/fund-limit" and data_service and method == "GET":\n        code = str((query.get("code") or [""])[0]).strip()\n        if not re.fullmatch(r"\\d{6}", code):\n            return HTTPStatus.BAD_REQUEST, {"error": "code_required"}\n        record = data_service.dataset_record("fund-limit", code)\n        if record is None:\n            return HTTPStatus.NOT_FOUND, {"error": "fund_limit_not_found", "code": code}\n        return HTTPStatus.OK, record.get("payload") or record\n\n    if route == "/fund-limit/overview" and data_service and method == "GET":\n        return HTTPStatus.OK, data_service.fund_limit_overview()\n\n'''
if anchor not in s:
    raise SystemExit('http aggregate anchor changed')
s = s.replace(anchor, routes + anchor, 1)
http.write_text(s)

# Config example must not suggest a Cloudflare market dependency.
config = Path('services/market-collector/config.example.json')
if config.exists():
    s = config.read_text().replace('"worker_url": "https://api.freebacktrack.tech",', '"worker_url": "",')
    config.write_text(s)
