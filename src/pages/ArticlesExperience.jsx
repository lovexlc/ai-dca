export const ARTICLES_URL = 'https://fast.freebacktrack.tech/wechat/';

export function ArticlesExperience() {
  return (
    <section
      className="h-[calc(100vh-10rem)] min-h-[560px] w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:h-[calc(100vh-8rem)] sm:min-h-[640px]"
      aria-label="公众号历史文章"
    >
      <iframe
        title="公众号历史文章"
        src={ARTICLES_URL}
        className="h-full w-full border-0"
        loading="eager"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </section>
  );
}
