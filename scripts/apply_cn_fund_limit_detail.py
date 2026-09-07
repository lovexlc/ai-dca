from pathlib import Path

home = Path('src/pages/CnHomeExperience.jsx')
text = home.read_text(encoding='utf-8')

def replace(old, new):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected one match, got {count}: {old[:100]}')
    text = text.replace(old, new, 1)

replace("import './cn-home.css';", "import './cn-home.css';\nimport { CnFundLimitDetail } from './CnFundLimitDetail.jsx';")
replace(
    'function Limits({ data, onFund }) {',
    'function Limits({ data, onFund, onOpenDetail }) {',
)
replace(
    '<div key={row.currency}><small>{row.currency} 可申购额度</small><strong>{compact(row.amount, row.currency)}</strong><em>{row.limitedCount ?? 0} 只限购</em></div>',
    '<button type="button" key={row.currency} onClick={() => onOpenDetail?.(row.currency)}><small>{row.currency} 可申购额度</small><strong>{compact(row.amount, row.currency)}</strong><em>{row.limitedCount ?? 0} 只限购</em><i>查看完整额度详情 ›</i></button>',
)
replace(
    'export function CnHomeExperience() {\n  const [state, setState]',
    "function readLimitCurrency() { if (typeof window === 'undefined') return ''; const params = new URLSearchParams(window.location.search); if (params.get('view') !== 'fund-limits') return ''; const value = String(params.get('currency') || 'CNY').toUpperCase(); return value === 'USD' ? 'USD' : 'CNY'; }\nexport function CnHomeExperience() {\n  const [limitCurrency, setLimitCurrency] = useState(readLimitCurrency);\n  const [state, setState]",
)
replace(
    '  useEffect(() => { refresh(false); }, [refresh]);',
    "  useEffect(() => { refresh(false); }, [refresh]);\n  useEffect(() => { const sync = () => setLimitCurrency(readLimitCurrency()); window.addEventListener('popstate', sync); return () => window.removeEventListener('popstate', sync); }, []);",
)
replace(
    "  function openFund(code) { if (!code) return; window.dispatchEvent(new CustomEvent('workspace:navigate', { detail: { tab: 'markets', search: `symbol=${encodeURIComponent(code)}` } })); }\n  return <main",
    "  function openFund(code) { if (!code) return; window.dispatchEvent(new CustomEvent('workspace:navigate', { detail: { tab: 'markets', search: `symbol=${encodeURIComponent(code)}` } })); }\n  function openLimitDetail(currency) { const value = String(currency || 'CNY').toUpperCase() === 'USD' ? 'USD' : 'CNY'; const url = new URL(window.location.href); url.searchParams.set('view', 'fund-limits'); url.searchParams.set('currency', value); window.history.pushState({ ...(window.history.state || {}), cnLimitDetail: true }, '', url); setLimitCurrency(value); window.scrollTo({ top: 0, behavior: 'auto' }); }\n  function switchLimitCurrency(currency) { const value = currency === 'USD' ? 'USD' : 'CNY'; const url = new URL(window.location.href); url.searchParams.set('view', 'fund-limits'); url.searchParams.set('currency', value); window.history.replaceState({ ...(window.history.state || {}), cnLimitDetail: true }, '', url); setLimitCurrency(value); }\n  function closeLimitDetail() { if (window.history.state?.cnLimitDetail) { window.history.back(); return; } const url = new URL(window.location.href); url.searchParams.delete('view'); url.searchParams.delete('currency'); window.history.replaceState(window.history.state, '', url); setLimitCurrency(''); }\n  if (limitCurrency) return <CnFundLimitDetail data={state.limits.data} currency={limitCurrency} loading={state.limits.loading} error={state.limits.error} onRetry={() => refresh(true)} onBack={closeLimitDetail} onSwitchCurrency={switchLimitCurrency} />;\n  return <main",
)
replace(
    '<Limits data={state.limits.data} onFund={openFund} />',
    '<Limits data={state.limits.data} onFund={openFund} onOpenDetail={openLimitDetail} />',
)
home.write_text(text, encoding='utf-8')

css = Path('src/pages/cn-home.css')
styles = css.read_text(encoding='utf-8')
styles = styles.replace('.cn-home-limit-total>div{padding:13px 15px}.cn-home-limit-total>div+div{border-left:1px solid #e8ebf0}', '.cn-home-limit-total>button,.cn-home-limit-total>div{padding:13px 15px}.cn-home-limit-total>button{position:relative;border:0;background:transparent;text-align:left;cursor:pointer}.cn-home-limit-total>button+button,.cn-home-limit-total>div+div{border-left:1px solid #e8ebf0}.cn-home-limit-total>button i{display:block;margin-top:8px;color:#1468f3;font-size:9px;font-style:normal}', 1)
css.write_text(styles, encoding='utf-8')

workspace = Path('src/pages/WorkspacePage.jsx')
wtext = workspace.read_text(encoding='utf-8')
old = "const PRESERVED_QUERY_PARAMS_BY_TAB = {\n  markets:"
new = "const PRESERVED_QUERY_PARAMS_BY_TAB = {\n  home: ['view', 'currency'],\n  markets:"
if wtext.count(old) != 1:
    raise SystemExit('workspace query map anchor not found')
workspace.write_text(wtext.replace(old, new, 1), encoding='utf-8')
