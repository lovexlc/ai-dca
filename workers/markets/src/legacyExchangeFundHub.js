// Legacy Durable Object 占位：ExchangeFundHub 已退役，仅保留类名导出
// （由 worker 入口 index.js re-export），以免残留引用解析失败。
// 任何请求直接返回 410。
export class ExchangeFundHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch() {
    return new Response(JSON.stringify({ error: 'legacy durable object retired' }), {
      status: 410,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }
}
