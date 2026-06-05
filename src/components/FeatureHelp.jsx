import { useState } from 'react';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';

// 各功能旁「页面状」帮助图标弹窗的内容。集中维护，方便后续按用户反馈调整文案。
const HELP_CONTENT = {
  'holdings-edit': {
    title: '删除交易 / 修改成本',
    summary: '怎么删掉一条买卖记录，以及如何调整持仓成本价。',
    sections: [
      {
        heading: '删除一条交易记录',
        steps: [
          '在持仓里点开对应基金，找到要删除的那条买入 / 卖出记录。',
          '点该记录进入「编辑交易」面板，拉到底部点红色「删除该交易」。',
          '在弹出的确认框里确认，记录即被删除，持仓与成本会自动重算。'
        ]
      },
      {
        heading: '修改持仓成本',
        steps: [
          '持仓成本是按你所有买入（BUY）记录自动加权平均算出来的，所以没有单独的「成本」输入框。',
          '想调整成本：编辑或删除对应的买入交易、或补录一条买入，成本会自动重新计算。',
          '卖出时如果系统里没有对应买入记录，可在面板勾选并填写「买入成本价（可选）」。'
        ]
      }
    ],
    screenshots: ['「编辑交易」面板底部：删除按钮与「买入成本价（可选）」字段']
  },
  'trade-plans': {
    title: '修改交易计划',
    summary: '老师配的计划不是固定默认值，每个都能单独改。',
    sections: [
      {
        heading: '编辑某个计划',
        steps: [
          '进入「交易计划」页，找到要改的计划卡片。',
          '点卡片上的 ✏️（或右上角菜单里的「编辑」）。',
          '加仓 / 定投计划会回到新建向导并带入原来的参数；卖出计划进入卖出编辑表单。改完保存即可。'
        ]
      },
      {
        heading: '删除计划',
        steps: ['在计划卡片点 🗑（或菜单里的「删除」），确认后删除。']
      }
    ],
    screenshots: ['交易计划卡片右上角的 🔔 测试 / ✏️ 编辑 / 🗑 删除 按钮']
  },
  'notify-test': {
    title: '测试通知是否成功',
    summary: '配置好通知渠道后，在哪里点测试、怎么判断收到。',
    sections: [
      {
        heading: '在哪里测试',
        steps: [
          '进入「通知」页，展开「消息推送配置」。',
          '按平台标签（iOS / Andriod / PC 浏览器）切到你用的渠道。',
          '每个渠道保存后，下方都有「测试」按钮，点一下会真实推送一条测试通知。'
        ]
      },
      {
        heading: '怎么判断成功',
        steps: [
          '对应设备（iPhone Bark / 安卓 Server酱³ / 当前浏览器）收到推送即代表成功。',
          '页面下方的通知事件列表也会记录这条测试（测试通知约保留 30 分钟）。',
          '如果提示发送失败，按提示检查对应渠道的 Key / 配置后重试。'
        ]
      }
    ],
    screenshots: ['「消息推送配置」里各渠道的「测试」按钮位置']
  },
  'android-notify': {
    title: '安卓：下载哪个 & 怎么配置',
    summary: '安卓系统通知通过第三方「Server酱³」转发，本产品本身是网页 / PWA。',
    sections: [
      {
        heading: '下载哪个',
        steps: [
          '本产品没有安卓应用商店 App，安卓系统通知靠「Server酱³」客户端转发。',
          '在「通知」页切到「Andriod」标签，点「安卓客户端下载地址」安装 Server酱³ 客户端：https://sc3.ft07.com/client',
          '想用网页版本身：直接用安卓浏览器打开网站，并「添加到主屏幕」，即可像 App 一样使用。'
        ]
      },
      {
        heading: '怎么配置',
        steps: [
          '打开「安卓配置设置地址」获取你的 UID 与 SendKey：https://sc3.ft07.com/sendkey',
          '回到「Andriod」面板，把 UID、SendKey 填进去，点「保存 Server酱³」。',
          '保存后点「测试」，安卓客户端收到推送即配置成功。',
          '注意：Server酱³ 是第三方服务，请勿泄漏自己的 UID 与 SendKey。'
        ]
      }
    ],
    screenshots: ['「Andriod」面板：下载链接、UID / SendKey 输入框与保存 / 测试按钮']
  }
};

export function FeatureHelp({ topic, className }) {
  const [open, setOpen] = useState(false);
  const content = HELP_CONTENT[topic];
  if (!content) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`查看「${content.title}」使用帮助`}
        title="使用帮助"
        className={cn(
          'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600',
          className
        )}
      >
        <FileText className="h-4 w-4" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{content.title}</DialogTitle>
            {content.summary ? <DialogDescription>{content.summary}</DialogDescription> : null}
          </DialogHeader>
          <div className="space-y-5 text-sm leading-6 text-slate-700">
            {content.sections.map((section, sectionIndex) => (
              <div key={sectionIndex} className="space-y-2">
                {section.heading ? (
                  <div className="text-sm font-semibold text-slate-900">{section.heading}</div>
                ) : null}
                <ol className="list-decimal space-y-1.5 pl-5">
                  {section.steps.map((step, stepIndex) => (
                    <li key={stepIndex} className="break-words">{step}</li>
                  ))}
                </ol>
              </div>
            ))}
            {Array.isArray(content.screenshots) && content.screenshots.length ? (
              <div className="space-y-2">
                {content.screenshots.map((label, shotIndex) => (
                  <div
                    key={shotIndex}
                    className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center text-xs text-slate-400"
                  >
                    <span className="text-base">📷</span>
                    <span>配图占位：{label}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
