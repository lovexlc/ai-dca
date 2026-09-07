from pathlib import Path
p=Path('src/pages/WorkspacePage.jsx'); s=p.read_text()
s=s.replace('BarChart3, Bell, BookOpen, LineChart', 'BarChart3, Bell, BookOpen, House, LineChart')
s=s.replace("const MarketsExperience = lazy(() => import('./MarketsExperience.jsx').then((m) => ({ default: m.MarketsExperience })));", "const MarketsExperience = lazy(() => import('./MarketsExperience.jsx').then((m) => ({ default: m.MarketsExperience })));\nconst CnHomeExperience = lazy(() => import('./CnHomeExperience.jsx').then((m) => ({ default: m.CnHomeExperience })));" )
s=s.replace("const WORKSPACE_TITLES = {\n", "const WORKSPACE_TITLES = {\n  home: '市场首页',\n")
s=s.replace("const SIDEBAR_ICONS = {\n", "const SIDEBAR_ICONS = {\n  home: House,\n")
s=s.replace("    switch (activeTab) {\n", "    switch (activeTab) {\n      case 'home':\n        return <CnHomeExperience {...sharedProps} />;\n")
p.write_text(s)
# retry after navigation files landed
