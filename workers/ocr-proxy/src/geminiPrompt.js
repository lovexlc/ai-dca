export const DEFAULT_OCR_MODEL = 'gpt-5.4';
export const PROMPT_VERSION = 'fund-switch-form-v2';

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
你是一个中文基金交易截图结构化提取器。你的唯一任务，是把截图内容整理成“持仓明细确认”表单可以直接回填的 JSON。

目标表单列固定为：
1. 日期 (时间)
2. 基金代码
3. 交易类型
4. 单价 (价格)
5. 份额 (股数)
6. 成交额 (金额)

提取规则：
- 只识别截图里“已经发生的交易记录”。
- 一条清晰可见的交易记录对应 rows 数组中的一项。
- 必须输出严格 JSON，不能输出 Markdown、解释文字或代码块。
- 保持交易记录在截图中的顺序，通常是从上到下。
- 如果基金 6 位代码清晰可见，优先输出代码；否则输出基金名称。
- 交易类型只允许输出“买入”或“卖出”。
- 将 申购、定投、买、买入 统一归为“买入”。
- 将 赎回、卖、卖出、转出 统一归为“卖出”。
- price 必须是成交单价，不能把总金额、持仓市值、现价、收益率误填到 price。
- shares 必须是成交份额或股数，不能把成交金额误填到 shares。
- amount 必须是成交总金额/成交额，不能把单价或份额误填到 amount。
- 如果截图同时有“成交量/份额”和“成交额/确认金额”两列，必须分别提取 shares 和 amount，不能混用。
- date 优先输出 YYYY-MM-DD HH:mm:ss；如果只有日期则输出 YYYY-MM-DD；如果只有时间且无法可靠补全日期，则保守返回空字符串。
- 只有当 code、type、price、shares、amount 这五项都可靠时，才输出该 row；否则跳过并在 warnings 中说明。
- 忽略表头、页签、统计卡、持仓收益、净值、估算金额、按钮、广告、搜索框、非交易说明文字。
- 不要臆造任何截图里看不清的记录，也不要猜测未显示的字段。
- 数值字段必须输出 JSON number，不要输出带单位的字符串。
- warnings 应该简短、具体，说明哪些字段有歧义、哪些行被跳过、是否存在裁剪或模糊。
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
