from pathlib import Path

path = Path('src/pages/CnHomeExperience.jsx')
text = path.read_text(encoding='utf-8')
replacements = {
    "const COLORS = ['#1468f3', '#e5484d', '#0aa870', '#f08c2e', '#7c3aed', '#0891b2'];": "const COLORS = ['#1468f3', '#e5484d', '#0aa870', '#f08c2e', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#dc6b19', '#4f46e5', '#0f766e', '#be123c', '#9333ea', '#0284c7', '#ca8a04', '#16a34a'];",
    "model.rows.slice(0, 8).map((line, i) =>": "model.rows.map((line, i) =>",
    "model.rows.slice(0, 6).map((line, i) => {": "model.rows.map((line, i) => {",
    "model.rows.slice(0, 6).map((line, i) => <span": "model.rows.map((line, i) => <span",
}
for old, new in replacements.items():
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected one match, got {count}: {old}')
    text = text.replace(old, new)
path.write_text(text, encoding='utf-8')
