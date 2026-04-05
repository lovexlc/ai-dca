import { useEffect } from 'react';
import { ArrowRight } from 'lucide-react';
import { PageHero, PageShell, primaryButtonClass } from '../components/experience-ui.jsx';

export function CatalogPage() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.location.replace('./index.html');
    }, 120);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <PageShell className="pb-20">
      <PageHero
        eyebrow="导航已更新"
        title="页面导航已移至首页标签页"
        description="旧目录页已停用，系统会自动回到首页。后续请直接在首页顶部通过标签页切换各功能页面。"
      />

      <div className="mx-auto max-w-3xl px-6 pt-8">
        <a className={primaryButtonClass} href="./index.html">
          返回首页
          <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    </PageShell>
  );
}
