import { ArrowRight, ExternalLink, LayoutGrid, Monitor, Smartphone } from 'lucide-react';
import { GROUP_META, HOME_SCREEN_ID, PROJECT_TITLE, getGroupedScreens, pageHref, screens } from '../app/screens.js';
import { Card, PageHero, PageShell, Pill, SectionHeading, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';

function screenLink(screen) {
  return screen.id === HOME_SCREEN_ID ? './index.html' : pageHref(screen.id);
}

export function CatalogPage() {
  const groups = getGroupedScreens();

  return (
    <PageShell className="pb-20">
      <PageHero
        eyebrow="Catalog"
        title={PROJECT_TITLE}
        description="统一调试入口已经切到 React 多页面架构。这里列出所有可访问页面分组，方便你在 `frontend/catalog.html` 下直接跳转预览。"
        badges={[
          <Pill key="pages" tone="indigo">{screens.length} 个页面</Pill>,
          <Pill key="groups" tone="slate">{groups.length} 个分组</Pill>
        ]}
        actions={
          <>
            <a className={secondaryButtonClass} href="./catalog.html">
              刷新目录
              <ExternalLink className="h-4 w-4" />
            </a>
            <a className={primaryButtonClass} href="./index.html">
              打开封面
              <ArrowRight className="h-4 w-4" />
            </a>
          </>
        }
      />

      <div className="mx-auto max-w-6xl space-y-6 px-6 pt-8">
        {groups.map((group) => (
          <Card key={group.key}>
            <SectionHeading
              eyebrow={GROUP_META[group.key]?.label}
              title={group.label}
              description={group.description}
              action={<Pill tone="slate">{group.screens.length} 页</Pill>}
            />

            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {group.screens.map((screen) => (
                <a key={screen.id} className="group rounded-[24px] border border-slate-200 bg-slate-50 p-5 transition-all hover:-translate-y-1 hover:bg-white hover:shadow-sm" href={screenLink(screen)}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200">
                      {screen.device === 'MOBILE' ? <Smartphone className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
                      {screen.deviceLabel}
                    </div>
                    <LayoutGrid className="h-4 w-4 text-slate-300 transition-colors group-hover:text-slate-500" />
                  </div>

                  <div className="mt-4 font-semibold text-slate-900">{screen.title}</div>
                  <div className="mt-2 text-sm leading-6 text-slate-500">{GROUP_META[screen.group]?.description}</div>

                  <div className="mt-5 flex items-center justify-between gap-4 text-xs text-slate-400">
                    <span className="truncate">{screen.id}</span>
                    <span className="inline-flex items-center gap-1 font-semibold text-indigo-600">
                      打开
                      <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </a>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
