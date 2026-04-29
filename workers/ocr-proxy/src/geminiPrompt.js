// 切换到 Cloudflare Workers AI 后默认走 Llama 3.2 Vision Instruct，支持 messages
// 格式 + 中文。可通过 wrangler.toml 中的 OCR_MODEL 环境变量改成其它视觉模型。
export const DEFAULT_OCR_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
export const PROMPT_VERSION = 'fund-switch-form-v2';
export const HOLDINGS_PROMPT_VERSION = 'fund-holdings-form-v2';

export const FUND_SWITCH_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    rows: {
      type: 'ARRAY',
      description: '按截图从上到下排序的持仓明细确认表单记录。',
      items: {
        type: 'OBJECT',
        properties: {
          date: {
            type: 'STRING',
            description: '日期或日期时间，优先返回 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss。'
          },
          code: {
            type: 'STRING',
            description: '基金代码或基金名称。若 6 位代码清晰可见优先返回代码，否则返回截图中的基金名称。'
          },
          type: {
            type: 'STRING',
            enum: ['买入', '卖出'],
            description: '交易类型，只能是 买入 或 卖出。'
          },
          price: {
            type: 'NUMBER',
            description: '成交单价，不是总金额。'
          },
          shares: {
            type: 'NUMBER',
            description: '成交份额或股数，不是成交总金额。'
          },
          amount: {
            type: 'NUMBER',
            description: '成交总金额，不是单价，不是份额。优先提取截图中的成交额/确认金额/成交金额列。'
          }
        },
        required: ['date', 'code', 'type', 'price', 'shares', 'amount']
      }
    },
    warnings: {
      type: 'ARRAY',
      description: '识别歧义、裁剪问题、缺失字段等短提示。',
      items: {
        type: 'STRING'
      }
    }
  },
  required: ['rows', 'warnings']
};

export const FUND_SWITCH_SYSTEM_PROMPT = `
你是一个中文券商 App 交易截图的结构化提取器。你的任务：把截图中的“成交明细/当日成交”信息，整理成可直接回填表单的 JSON。模型可能为多模态对话模型（如 Kimi），请严格遵守输出与字段要求。

目标字段（每条交易一行）：
1. date：成交时间或日期时间（优先 YYYY-MM-DD HH:mm:ss；若仅有时间，如 14:29:29，则直接输出时间字符串）
2. code：基金 6 位代码；若截图无代码，允许返回基金名称（如 “纳斯达克”）作为备用标识
3. type：只能是 “买入” 或 “卖出”（含义映射：申购/定投/买 = 买入；赎回/卖/转出 = 卖出）
4. price：成交单价（JSON number）
5. shares：成交份额/成交量（JSON number）
6. amount：成交额/成交金额（JSON number）

适配常见页面布局与字段：
- 券商 APP（如“当日成交”页）常见列名：成交时间、成交价、成交量、成交额、买入/卖出。
- 若只出现“买入 30203.400”这种右侧大号红字，请解析为 type=买入，amount=30203.400。
- 数字请移除千分位与单位，保留为 JSON number（如 30,203.400 → 30203.4）。
- 若看不到 6 位基金代码，但能看到中文名称（如 “纳斯达克”），将名称写入 code 字段。

输出要求：
- 仅识别已发生的成交记录；从上到下输出。
- 严格输出 JSON（不要 Markdown、不要解释文字、不要代码块围栏）。
- rows 中每项必须包含上述 6 个字段；无法可靠识别时跳过该行，并在 warnings 里简述原因。
- 忽略表头、页签、统计栏、广告、按钮等非成交信息。

示例（示意）：
输入截图含：时间 14:29:29；名称 “纳斯达克”；成交价 2.127；成交量 14200；买入；成交额 30203.400。
则输出可为：
{
  "rows": [
    {"date": "14:29:29", "code": "纳斯达克", "type": "买入", "price": 2.127, "shares": 14200, "amount": 30203.4}
  ],
  "warnings": []
}
`.trim();

export function buildOcrUserPrompt(fileName = 'uploaded-image') {
  return [
    `请分析这张基金交易截图，并输出“持仓明细确认”表单 JSON。`,
    `文件名: ${fileName}`,
    `每条 row 必须包含 date、code、type、price、shares、amount 六个字段。`,
    `输出格式只允许包含 rows 和 warnings 两个字段。`,
    `如果截图里没有足够清晰的交易记录，请返回 {"rows":[],"warnings":[...]}。`
  ].join('\n');
}

export const HOLDINGS_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    rows: {
      type: 'ARRAY',
      description: '当前持仓列表，从截图上方到下方排序。输出基金持仓识别与补全所需的原始字段，后续由 Worker 做代码/净值补全与均价反推。',
      items: {
        type: 'OBJECT',
        properties: {
          code: {
            type: 'STRING',
            description: '基金 6 位代码；若截图里看不清可返回空字符串。'
          },
          name: {
            type: 'STRING',
            description: '基金名称；若截图被截断，尽量按常识补全。'
          },
          avgCost: {
            type: 'NUMBER',
            description: '买入均价 / 持仓均价 / 成本价；若截图没有可返回 0。'
          },
          marketValue: {
            type: 'NUMBER',
            description: '持有金额 / 资产市值；若无则返回 0。'
          },
          holdingProfit: {
            type: 'NUMBER',
            description: '持有收益金额，可为负数；若无则返回 0。'
          },
          shares: {
            type: 'NUMBER',
            description: '当前持有份数；若截图无份额但可用图片净值直接计算，也可直接返回计算后的值。'
          },
          unitNav: {
            type: 'NUMBER',
            description: '单位净值；若图片中没有则返回 0。'
          },
          unitNavDate: {
            type: 'STRING',
            description: '图片中可见的单位净值日期；若无则返回空字符串。'
          }
        },
        required: ['code', 'name', 'avgCost', 'marketValue', 'holdingProfit', 'shares', 'unitNav', 'unitNavDate']
      }
    },
    warnings: {
      type: 'ARRAY',
      description: '识别歧义、字段缺失、跳过原因等短提示。',
      items: {
        type: 'STRING'
      }
    }
  },
  required: ['rows', 'warnings']
};

export const HOLDINGS_SYSTEM_PROMPT = `
你是一个专业的理财数据分析助手，但当前这一步只负责把基金持仓截图做成结构化 JSON，供后端继续补码、查净值和反推均价。

任务目标：
请分析我上传的基金持仓截图，识别并提取每个基金的核心数据：
- 基金名称
- 持有收益
- 持有金额 / 资产市值
- 持仓份额
- 若图片中清晰可见，也请提取基金代码、单位净值、单位净值日期、买入均价

处理逻辑与规则：
1. 直接提取：如果图片中完整显示了核心信息，请直接提取。对于名称被截断（如带有“...”）的基金，请根据常识尽量补全全称。
2. 图片内计算：如果图片中缺少持仓份额，但明确显示了持有金额和单位净值，请直接计算 shares = 持有金额 ÷ 单位净值，结果保留两位小数。
3. 不要在这一层臆造联网结果：如果图片中没有基金代码、没有单位净值，允许把 code 留空、unitNav 记为 0、unitNavDate 留空，由后端继续处理。
4. 如果图片中直接显示了买入均价 / 持仓均价 / 成本价，请提取到 avgCost；如果没有，可返回 0。

输出要求：
- 只识别“当前持仓列表”，不是交易流水，不是历史明细，不是收益走势图。
- 一条清晰可见的当前持仓对应 rows 数组中的一项。
- 必须输出严格 JSON，不能输出 Markdown、解释文字或代码块。
- 保持截图里从上到下的顺序。
- 所有数值字段必须输出 JSON number，不要输出带单位的字符串。
- holdingProfit 可以为负数。
- marketValue 必须是持有金额 / 资产市值，不要把收益率、净值、份额误填进去。
- shares 必须是当前持有份数；若由图片里的持有金额和单位净值计算得到，也直接输出计算后的结果。
- avgCost 只有在图片中清晰显示时才直接提取；不要把最新净值、昨收、估值、涨跌幅、持仓市值、收益金额误填到 avgCost。
- 如果 code 在图片中清晰可见，优先提取 6 位数字代码；如果不清晰，可返回空字符串，不要猜测。
- 忽略表头、页签、总资产、今日收益、累计收益、按钮、广告、搜索框、说明文案。
- 如果某一行无法形成可靠识别，可跳过并在 warnings 中说明原因。
- warnings 应简短、具体，说明名称截断、字段缺失、裁剪模糊、哪些行被跳过。
`.trim();

export function buildHoldingsOcrUserPrompt(fileName = 'uploaded-image') {
  return [
    '请按基金持仓截图识别逻辑输出 JSON，不要输出 Markdown 表格。',
    `文件名: ${fileName}`,
    '每条 row 必须包含 code、name、avgCost、marketValue、holdingProfit、shares、unitNav、unitNavDate 八个字段。',
    '截图里有就直接提取；截图里缺少代码/净值时，不要猜测，留空或返回 0。',
    '如果图片中有持有金额和单位净值但没有份额，请直接计算 shares。',
    '输出格式只允许包含 rows 和 warnings 两个字段。',
    '如果截图里没有足够清晰的当前持仓，请返回 {"rows":[],"warnings":[...]}。'
  ].join('\n');
}
