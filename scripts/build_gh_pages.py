#!/usr/bin/env python3
from __future__ import annotations

import html
import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXPORT_DIR = ROOT / "stitch-export" / "project-4075224789216868860-latest"
DOCS_DIR = ROOT / "docs"
LATEST_SCREEN_ID = "557ab0ae2a534a07a21f921a17e4f7fe"


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


def copy_export_assets(export_manifest: dict) -> list[dict]:
    pages_dir = DOCS_DIR / "pages"
    screenshots_dir = DOCS_DIR / "screenshots"
    pages_dir.mkdir(parents=True, exist_ok=True)
    screenshots_dir.mkdir(parents=True, exist_ok=True)

    site_manifest: list[dict] = []
    for screen in export_manifest["screens"]:
        screen_id = screen["screen_id"]
        title = screen["title"]
        device = screen["device"]

        page_rel = None
        shot_rel = None

        if screen["html_path"]:
            src_html = Path(screen["html_path"])
            dst_html = pages_dir / f"{screen_id}.html"
            shutil.copy2(src_html, dst_html)
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
                "is_latest": screen_id == LATEST_SCREEN_ID,
            }
        )

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
    latest = next(item for item in site_manifest if item["screen_id"] == LATEST_SCREEN_ID)
    latest_src = DOCS_DIR / latest["page_url"]
    latest_html = latest_src.read_text(encoding="utf-8")
    (DOCS_DIR / "index.html").write_text(inject_catalog_link(latest_html), encoding="utf-8")


def build_catalog(export_manifest: dict, site_manifest: list[dict]) -> None:
    latest = next(item for item in site_manifest if item["screen_id"] == LATEST_SCREEN_ID)
    latest_title = next(item["title"] for item in site_manifest if item["screen_id"] == LATEST_SCREEN_ID)
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
        <p>这个目录已经整理成 GitHub Pages 可直接部署的纯静态站点。默认首页使用你最新的“定投计划命名优化版”，其余 Stitch 页面保存在独立页面目录里，方便继续挑选、对比和二次开发。</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="./index.html">打开默认首页</a>
          <a class="btn btn-secondary" href="./{latest["page_url"]}">打开最新源码页</a>
        </div>
      </div>
      <div class="panel">
        <h2>当前发布信息</h2>
        <div class="meta-list">
          <div class="meta-row"><span class="meta-label">项目 ID</span><strong>{html.escape(export_manifest["project_id"])}</strong></div>
          <div class="meta-row"><span class="meta-label">项目标题</span><strong>{html.escape(export_manifest["project_title"])}</strong></div>
          <div class="meta-row"><span class="meta-label">最新首页</span><strong>{html.escape(latest_title)}</strong></div>
          <div class="meta-row"><span class="meta-label">HTML 页面数</span><strong>{export_manifest["html_count"]}</strong></div>
          <div class="meta-row"><span class="meta-label">截图数量</span><strong>{export_manifest["screenshot_count"]}</strong></div>
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
      const latest = item.is_latest ? '<span class="chip">最新</span>' : '';
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
            <div class="card-meta">${{latest}}${{device}}</div>
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
    out = {
        "project_id": export_manifest["project_id"],
        "project_title": export_manifest["project_title"],
        "latest_screen_id": LATEST_SCREEN_ID,
        "html_count": export_manifest["html_count"],
        "screenshot_count": export_manifest["screenshot_count"],
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
    site_manifest = copy_export_assets(export_manifest)
    build_homepage(site_manifest)
    build_catalog(export_manifest, site_manifest)
    write_site_manifest(export_manifest, site_manifest)
    write_nojekyll()
    print(f"Built GitHub Pages site at: {DOCS_DIR}")


if __name__ == "__main__":
    main()
