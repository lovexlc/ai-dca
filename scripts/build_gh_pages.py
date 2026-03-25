#!/usr/bin/env python3
from __future__ import annotations

import html
import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXPORT_DIR = ROOT / "stitch-export" / "project-4075224789216868860-latest"
DOCS_DIR = ROOT / "docs"
RUNTIME_SRC = ROOT / "scripts" / "stitch_runtime.js"
RUNTIME_ASSET_NAME = "stitch-runtime.js"
HOMEPAGE_SCREEN_ID = "75a393ec1a2d424ebafa1d0e59402d26"
EXCLUDED_TITLE_KEYWORDS = ("投资计划极简首页",)
RUNTIME_GROUPS = {"home", "accum_edit", "accum_new", "dca"}

ROUTE_TARGETS = {
    "home": {"root": "./index.html", "page": "75a393ec1a2d424ebafa1d0e59402d26.html"},
    "accum_edit": {"root": "./pages/81fee20edb5542f08bb363ac837b327c.html", "page": "81fee20edb5542f08bb363ac837b327c.html"},
    "accum_new": {"root": "./pages/03ef40c5dff048f8b1416a6a4567f9ee.html", "page": "03ef40c5dff048f8b1416a6a4567f9ee.html"},
    "add_level": {"root": "./pages/d142c0822784448ab9b8016e300bd25c.html", "page": "d142c0822784448ab9b8016e300bd25c.html"},
    "dca": {"root": "./pages/530f6fe554444798820046dee4d4b889.html", "page": "530f6fe554444798820046dee4d4b889.html"},
    "history": {"root": "./pages/65aaf3e700d3443c9810f6c727b045e8.html", "page": "65aaf3e700d3443c9810f6c727b045e8.html"},
    "catalog": {"root": "./catalog.html", "page": "../catalog.html"},
}

SCREEN_GROUPS = {
    "home": {
        "75a393ec1a2d424ebafa1d0e59402d26",
        "8692ca0737d74aa78bd270ddbd5b1bf6",
        "d8f0b16bd9d24c62992a5198ba3fa857",
        "8d93d9d89df94ffdafd339da9d50f0b7",
        "0754eda620a54150bd6b646b17aedc95",
        "0b7f16c425a94d759f2a42e81a76be26",
        "26eb098db14e4c4bb059b607c9578acc",
        "42a1829a673444b584ff07bf3d340678",
        "4acb407f6b6f4aa19d48e14db8fc3a02",
    },
    "accum_edit": {
        "81fee20edb5542f08bb363ac837b327c",
        "810ef0f6ff574c049df021d099547b63",
        "d4ce671ce96341e1b4f20743a78c4963",
        "3b3fa48876b2428c8b0da9b5a6d0b21d",
        "13991f2d68d64c138978ca10834cf4e6",
    },
    "add_level": {
        "d142c0822784448ab9b8016e300bd25c",
    },
    "accum_new": {
        "03ef40c5dff048f8b1416a6a4567f9ee",
        "09c23b22bbfb45f090edd43a2022b1d6",
    },
    "dca": {
        "530f6fe554444798820046dee4d4b889",
        "6878eff12a044d799bb7943f2753cbfa",
        "8a9f687cbc2b43aa8ff9a3fee729d4f0",
        "01a499e7120746da9b03b18b20876e4a",
        "42e23956702a4e488dfd2e7d002b1a1f",
        "328ef14fcb034d1186f1d3fe19c7852f",
    },
    "history": {
        "65aaf3e700d3443c9810f6c727b045e8",
    },
}

GROUP_RULES = {
    "home": {
        "交易": "home",
        "初始建仓": "home",
        "建仓": "home",
        "风险分散": "accum_edit",
        "加仓": "accum_edit",
        "成本摊薄": "dca",
        "定投": "dca",
        "add 新建仓计划": "accum_new",
        "add 新建策略计划": "accum_new",
        "add New Accumulation": "accum_new",
        "edit 修改配置": "accum_edit",
        "edit 编辑配置": "accum_edit",
        "edit Edit Config": "accum_edit",
    },
    "accum_edit": {
        "控制面板": "home",
        "Dashboard": "home",
        "dashboard 仪表板": "home",
        "建仓计划": "home",
        "Accumulation": "home",
        "策略列表": "home",
        "数据分析": "history",
        "Analytics": "history",
        "analytics 策略分析": "history",
        "history 交易历史": "history",
        "add + 新增层级": "add_level",
        "add 新增层级": "add_level",
        "add_circle 添加阶梯": "add_level",
        "保存更改": "home",
        "save 保存更改": "home",
        "保存策略": "home",
        "取消": "home",
        "description Reports": "history",
        "analytics 分析": "history",
        "account_balance_wallet Strategies": "home",
        "dashboard 概览": "home",
        "account_balance_wallet 策略": "home",
        "description 报告": "history",
        "settings 设置": "catalog",
        "person 账户设置": "catalog",
        "logout 退出登录": "catalog",
    },
    "add_level": {
        "arrow_back 返回加仓策略配置": "accum_edit",
        "保存层级配置": "accum_edit",
        "取消": "accum_edit",
    },
    "accum_new": {
        "arrow_back": "home",
        "确认创建": "home",
        "取消": "home",
        "dashboard Dashboard": "home",
        "layers Accumulation": "home",
        "analytics Analytics": "history",
        "visibility Watchlist": "home",
        "history History": "history",
    },
    "dca": {
        "策略": "dca",
        "Strategy": "dca",
        "交易": "home",
        "Trading": "home",
        "分析": "history",
        "Analytics": "history",
        "Dashboard": "home",
        "dashboard Dashboard": "home",
        "dashboard 仪表盘": "home",
        "visibility Watchlist": "home",
        "visibility 自选股": "home",
        "history Strategy History": "history",
        "history 策略历史": "history",
        "leaderboard Reports": "history",
        "leaderboard 报告": "history",
        "tune Settings": "catalog",
        "tune 设置": "catalog",
        "add New Strategy": "dca",
        "add 新策略": "dca",
        "保存并启动策略": "home",
        "play_circle 保存并启动策略": "home",
        "取消": "home",
        "查看历史模拟回测": "history",
        "下载策略白皮书": "catalog",
        "save": "home",
        "Markets": "history",
        "show_chart Markets": "history",
        "insights Strategies": "dca",
        "account_balance_wallet Portfolio": "history",
        "settings Settings": "catalog",
        "tactic Strategies": "dca",
        "monitoring Analysis": "history",
        "account_balance_wallet Wallet": "history",
        "history History": "history",
        "home Home": "home",
        "show_chart Market": "history",
        "layers Strategy": "home",
        "person Profile": "catalog",
    },
    "history": {
        "dashboard Dashboard": "home",
        "account_balance_wallet Portfolio": "history",
        "receipt_long Transactions": "history",
        "layers Strategy": "home",
        "settings Settings": "catalog",
        "arrow_back": "home",
        "导出报告": "history",
        "筛选日期": "history",
        "查看详细策略": "home",
    },
}

GLOBAL_RULES = {
    "help 技术支持": "catalog",
    "help 帮助中心": "catalog",
    "help Support": "catalog",
    "warning 风险披露": "catalog",
    "warning Risk Disclosure": "catalog",
    "操作说明": "catalog",
    "策略原理": "catalog",
    "风险提示": "catalog",
    "Operational Instructions": "catalog",
    "Strategy Principles": "catalog",
    "Risk Warnings": "catalog",
}


def safe_unlink(path: Path) -> None:
    if path.exists():
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()


def read_export_manifest() -> dict:
    manifest_path = EXPORT_DIR / "manifest.json"
    with manifest_path.open("r", encoding="utf-8") as f:
        return json.load(f)


def should_publish(screen: dict) -> bool:
    title = screen["title"]
    return all(keyword not in title for keyword in EXCLUDED_TITLE_KEYWORDS)


def published_counts(site_manifest: list[dict]) -> tuple[int, int]:
    html_count = sum(1 for item in site_manifest if item["page_url"])
    screenshot_count = sum(1 for item in site_manifest if item["screenshot_url"])
    return html_count, screenshot_count


def homepage_item(site_manifest: list[dict]) -> dict:
    return next(item for item in site_manifest if item["screen_id"] == HOMEPAGE_SCREEN_ID)


def group_for_screen(screen_id: str) -> str | None:
    for group_name, screen_ids in SCREEN_GROUPS.items():
        if screen_id in screen_ids:
            return group_name
    return None


def navigation_rules(screen_id: str) -> dict[str, str]:
    rules = dict(GLOBAL_RULES)
    group_name = group_for_screen(screen_id)
    if group_name:
        rules = {**rules, **GROUP_RULES.get(group_name, {})}
    return rules


def append_before_body(raw_html: str, addition: str) -> str:
    if "</body>" in raw_html:
        return raw_html.replace("</body>", f"{addition}\n</body>")
    return raw_html + addition


def inject_runtime_patch(screen_id: str, raw_html: str) -> str:
    group_name = group_for_screen(screen_id)
    if group_name not in RUNTIME_GROUPS:
        return raw_html

    script = (
        f'<script defer data-stitch-runtime="true" data-group="{html.escape(group_name)}" '
        f'src="../assets/{RUNTIME_ASSET_NAME}"></script>'
    )
    return append_before_body(raw_html, script)


def rewrite_home_tabs(screen_id: str, raw_html: str) -> str:
    if group_for_screen(screen_id) != "home":
        return raw_html

    replacements = {
        ">交易</a>": ">初始建仓</a>",
        ">风险分散</a>": ">加仓</a>",
        ">成本摊薄</a>": ">定投</a>",
    }
    for old, new in replacements.items():
        raw_html = raw_html.replace(old, new)
    return raw_html


def inject_navigation_patch(screen_id: str, raw_html: str) -> str:
    rules = navigation_rules(screen_id)
    if not rules:
        return raw_html

    script = f"""
<script data-stitch-nav-patch="true">
(() => {{
  const routes = {json.dumps(ROUTE_TARGETS, ensure_ascii=False)};
  const rules = {json.dumps(rules, ensure_ascii=False)};
  const insidePages = window.location.pathname.includes('/pages/');
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
  const resolveRoute = (targetKey) => {{
    const route = routes[targetKey];
    if (!route) return null;
    return insidePages ? route.page : route.root;
  }};
  const bindTarget = (element, href) => {{
    if (!href) return;
    if (element.tagName === 'A') {{
      element.setAttribute('href', href);
      return;
    }}
    element.setAttribute('type', 'button');
    element.style.cursor = 'pointer';
    element.addEventListener('click', (event) => {{
      event.preventDefault();
      window.location.href = href;
    }});
  }};

  document.querySelectorAll('a[href="#"], button').forEach((element) => {{
    const text = normalize(element.textContent);
    if (!text) return;
    const targetKey = rules[text];
    if (!targetKey) return;
    bindTarget(element, resolveRoute(targetKey));
  }});
}})();
</script>
""".strip()
    return append_before_body(raw_html, script)


def copy_runtime_asset() -> None:
    assets_dir = DOCS_DIR / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(RUNTIME_SRC, assets_dir / RUNTIME_ASSET_NAME)


def copy_export_assets(export_manifest: dict) -> list[dict]:
    pages_dir = DOCS_DIR / "pages"
    screenshots_dir = DOCS_DIR / "screenshots"
    pages_dir.mkdir(parents=True, exist_ok=True)
    screenshots_dir.mkdir(parents=True, exist_ok=True)

    site_manifest: list[dict] = []
    for screen in export_manifest["screens"]:
        if not should_publish(screen):
            continue

        screen_id = screen["screen_id"]
        title = screen["title"]
        device = screen["device"]

        page_rel = None
        shot_rel = None

        if screen["html_path"]:
            src_html = Path(screen["html_path"])
            dst_html = pages_dir / f"{screen_id}.html"
            raw_html = src_html.read_text(encoding="utf-8")
            raw_html = rewrite_home_tabs(screen_id, raw_html)
            raw_html = inject_runtime_patch(screen_id, raw_html)
            raw_html = inject_navigation_patch(screen_id, raw_html)
            dst_html.write_text(raw_html, encoding="utf-8")
            page_rel = f"pages/{screen_id}.html"

        if screen["screenshot_path"]:
            src_shot = Path(screen["screenshot_path"])
            dst_shot = screenshots_dir / f"{screen_id}.png"
            shutil.copy2(src_shot, dst_shot)
            shot_rel = f"screenshots/{screen_id}.png"

        site_manifest.append(
            {
                "screen_id": screen_id,
                "title": title,
                "device": device,
                "page_url": page_rel,
                "screenshot_url": shot_rel,
                "is_homepage": screen_id == HOMEPAGE_SCREEN_ID,
            }
        )

    site_manifest.sort(key=lambda item: item["screen_id"] != HOMEPAGE_SCREEN_ID)
    return site_manifest


def inject_catalog_link(raw_html: str) -> str:
    badge = """
<a href="./catalog.html" style="
position: fixed;
right: 20px;
bottom: 20px;
z-index: 9999;
padding: 10px 14px;
border-radius: 999px;
background: rgba(15, 23, 42, 0.92);
color: #ffffff;
font: 600 13px/1 Inter, sans-serif;
text-decoration: none;
box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
">页面目录</a>
""".strip()
    if "</body>" in raw_html:
        return raw_html.replace("</body>", f"{badge}\n</body>")
    return raw_html + badge


def build_homepage(site_manifest: list[dict]) -> None:
    homepage = homepage_item(site_manifest)
    homepage_src = DOCS_DIR / homepage["page_url"]
    homepage_html = homepage_src.read_text(encoding="utf-8").replace(
        f"../assets/{RUNTIME_ASSET_NAME}",
        f"./assets/{RUNTIME_ASSET_NAME}",
    )
    (DOCS_DIR / "index.html").write_text(inject_catalog_link(homepage_html), encoding="utf-8")


def build_catalog(export_manifest: dict, site_manifest: list[dict]) -> None:
    homepage = homepage_item(site_manifest)
    homepage_title = homepage["title"]
    html_count, screenshot_count = published_counts(site_manifest)
    rows = json.dumps(site_manifest, ensure_ascii=False)

    catalog_html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Stitch 页面目录</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f8fafc;
      --surface: #ffffff;
      --text: #0f172a;
      --muted: #64748b;
      --line: #e2e8f0;
      --accent: #2563eb;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: linear-gradient(180deg, #f8fafc 0%, #eef4ff 100%);
      color: var(--text);
      font: 14px/1.6 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }}
    .wrap {{
      max-width: 1200px;
      margin: 0 auto;
      padding: 40px 24px 72px;
    }}
    .hero {{
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 24px;
      align-items: stretch;
      margin-bottom: 32px;
    }}
    .panel {{
      background: rgba(255, 255, 255, 0.92);
      border: 1px solid rgba(226, 232, 240, 0.9);
      border-radius: 24px;
      padding: 28px;
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.06);
      backdrop-filter: blur(10px);
    }}
    h1 {{
      margin: 0 0 12px;
      font-size: clamp(32px, 4vw, 52px);
      line-height: 1.05;
      letter-spacing: -0.04em;
      font-family: Manrope, Inter, sans-serif;
    }}
    h2 {{
      margin: 0 0 10px;
      font-size: 20px;
      font-family: Manrope, Inter, sans-serif;
    }}
    p {{
      margin: 0;
      color: var(--muted);
    }}
    .hero-actions {{
      display: flex;
      gap: 12px;
      margin-top: 24px;
      flex-wrap: wrap;
    }}
    .btn {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 44px;
      padding: 0 16px;
      border-radius: 999px;
      font-weight: 600;
      text-decoration: none;
      border: 1px solid transparent;
    }}
    .btn-primary {{
      background: var(--accent);
      color: #fff;
    }}
    .btn-secondary {{
      background: #fff;
      color: var(--text);
      border-color: var(--line);
    }}
    .meta-list {{
      display: grid;
      gap: 14px;
    }}
    .meta-row {{
      display: flex;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid var(--line);
      padding-bottom: 12px;
    }}
    .meta-row:last-child {{
      border-bottom: 0;
      padding-bottom: 0;
    }}
    .meta-label {{
      color: var(--muted);
    }}
    .section-head {{
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 16px;
      margin: 10px 0 18px;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 18px;
    }}
    .card {{
      background: rgba(255, 255, 255, 0.92);
      border: 1px solid rgba(226, 232, 240, 0.9);
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 12px 28px rgba(15, 23, 42, 0.05);
    }}
    .thumb {{
      aspect-ratio: 16 / 10;
      background: linear-gradient(135deg, #eff6ff 0%, #e2e8f0 100%);
      border-bottom: 1px solid var(--line);
      display: block;
      width: 100%;
      object-fit: cover;
    }}
    .card-body {{
      padding: 16px;
    }}
    .card-title {{
      margin: 0 0 8px;
      font: 700 17px/1.35 Manrope, Inter, sans-serif;
    }}
    .card-meta {{
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }}
    .chip {{
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 0 10px;
      border-radius: 999px;
      background: #eff6ff;
      color: #1d4ed8;
      font-size: 12px;
      font-weight: 600;
    }}
    .chip-muted {{
      background: #f1f5f9;
      color: #475569;
    }}
    .card-links {{
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }}
    .card-links a {{
      color: var(--accent);
      text-decoration: none;
      font-weight: 600;
    }}
    .footnote {{
      margin-top: 26px;
      color: var(--muted);
      font-size: 13px;
    }}
    @media (max-width: 860px) {{
      .hero {{
        grid-template-columns: 1fr;
      }}
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <div class="panel">
        <h1>Stitch 页面目录</h1>
        <p>这个目录已经整理成 GitHub Pages 可直接部署的纯静态站点。默认首页已经切换为“股票左侧建仓计算器 - 金字塔比例增强版”，并且关键页面之间补上了与 Stitch 原型一致的跳转关系。</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="./index.html">打开默认封面</a>
          <a class="btn btn-secondary" href="./{homepage["page_url"]}">打开封面源码页</a>
        </div>
      </div>
      <div class="panel">
        <h2>当前发布信息</h2>
        <div class="meta-list">
          <div class="meta-row"><span class="meta-label">项目 ID</span><strong>{html.escape(export_manifest["project_id"])}</strong></div>
          <div class="meta-row"><span class="meta-label">项目标题</span><strong>{html.escape(export_manifest["project_title"])}</strong></div>
          <div class="meta-row"><span class="meta-label">默认封面</span><strong>{html.escape(homepage_title)}</strong></div>
          <div class="meta-row"><span class="meta-label">已发布 HTML</span><strong>{html_count}</strong></div>
          <div class="meta-row"><span class="meta-label">已发布截图</span><strong>{screenshot_count}</strong></div>
        </div>
      </div>
    </section>

    <section>
      <div class="section-head">
        <div>
          <h2>全部页面</h2>
          <p>可直接点击页面进入单独 HTML，也可以通过预览图快速定位。</p>
        </div>
      </div>
      <div class="grid" id="grid"></div>
      <p class="footnote">说明：部分移动版或流程页没有截图，卡片会显示占位背景；页面源码都保存在 <code>docs/pages/</code> 下。</p>
    </section>
  </div>

  <script>
    const screens = {rows};
    const grid = document.getElementById("grid");
    const cardHtml = (item) => {{
      const screenshot = item.screenshot_url
        ? `<img class="thumb" src="${{item.screenshot_url}}" alt="${{item.title}} 预览图" loading="lazy">`
        : `<div class="thumb"></div>`;
      const homepage = item.is_homepage ? '<span class="chip">封面</span>' : '';
      const device = `<span class="chip chip-muted">${{item.device}}</span>`;
      const htmlLink = item.page_url
        ? `<a href="${{item.page_url}}">打开页面</a>`
        : '';
      const shotLink = item.screenshot_url
        ? `<a href="${{item.screenshot_url}}">查看预览图</a>`
        : '';
      return `
        <article class="card">
          ${{screenshot}}
          <div class="card-body">
            <h3 class="card-title">${{item.title}}</h3>
            <div class="card-meta">${{homepage}}${{device}}</div>
            <p style="margin: 0 0 12px; color: var(--muted); font-size: 13px;">屏幕 ID：${{item.screen_id}}</p>
            <div class="card-links">${{htmlLink}}${{shotLink}}</div>
          </div>
        </article>
      `;
    }};
    grid.innerHTML = screens.map(cardHtml).join("");
  </script>
</body>
</html>
"""
    (DOCS_DIR / "catalog.html").write_text(catalog_html, encoding="utf-8")


def write_site_manifest(export_manifest: dict, site_manifest: list[dict]) -> None:
    html_count, screenshot_count = published_counts(site_manifest)
    out = {
        "project_id": export_manifest["project_id"],
        "project_title": export_manifest["project_title"],
        "homepage_screen_id": HOMEPAGE_SCREEN_ID,
        "html_count": html_count,
        "screenshot_count": screenshot_count,
        "screens": site_manifest,
    }
    (DOCS_DIR / "manifest.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def write_nojekyll() -> None:
    (DOCS_DIR / ".nojekyll").write_text("", encoding="utf-8")


def main() -> None:
    export_manifest = read_export_manifest()
    safe_unlink(DOCS_DIR)
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    copy_runtime_asset()
    site_manifest = copy_export_assets(export_manifest)
    build_homepage(site_manifest)
    build_catalog(export_manifest, site_manifest)
    write_site_manifest(export_manifest, site_manifest)
    write_nojekyll()
    print(f"Built GitHub Pages site at: {DOCS_DIR}")


if __name__ == "__main__":
    main()
