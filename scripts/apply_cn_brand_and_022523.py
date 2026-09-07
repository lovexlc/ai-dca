from pathlib import Path

replacements = {
    'src/app/marketsWatchlistStorage.js': (
        "{ symbol: '022523', name: '易方达标普500指数(QDII-LOF)A人民币' }",
        "{ symbol: '022523', name: '天弘标普500发起(QDII-FOF)D' }",
    ),
    'src/app/nasdaqCatalog.js': (
        "{ code: '022523', name: '易方达标普500指数(QDII-LOF)A人民币', index_key: 'sp500', kind: 'standalone_qdii', link_to: null, share_class: 'A', currency: 'CNY' }",
        "{ code: '022523', name: '天弘标普500发起(QDII-FOF)D', index_key: 'sp500', kind: 'standalone_qdii', link_to: null, share_class: 'D', currency: 'CNY' }",
    ),
}
for file_name, (old, new) in replacements.items():
    path = Path(file_name)
    text = path.read_text(encoding='utf-8')
    if text.count(old) != 1:
        raise SystemExit(f'expected one match in {file_name}, got {text.count(old)}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')

css = Path('src/components/brand-preview-bar.css')
styles = css.read_text(encoding='utf-8')
addition = '\n@media (min-width: 768px) {\n  .brand-preview-bar .app-header__inner {\n    width: 100%;\n    max-width: none;\n    margin-inline: 0;\n    padding-left: 16px;\n  }\n}\n'
if addition.strip() not in styles:
    css.write_text(styles.rstrip() + addition, encoding='utf-8')
