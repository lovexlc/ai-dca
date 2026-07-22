import { CheckCircle2, Circle, Loader2, RotateCcw, X, XCircle } from 'lucide-react';
import { useState } from 'react';
import { runSwitchQuickTest } from '../../app/switchStrategySync.js';
import { cx } from '../experience-ui.jsx';
import { formatSwitchPercent, SwitchButton } from './ui.jsx';

function StepList({ steps = [], running = false }) {
  return (
    <div className="mt-4 space-y-2">
      {steps.map((step) => (
        <div key={step.key} className="flex items-center gap-2 text-sm">
          <span
            className={cx(
              step.status === 'passed'
                ? 'text-emerald-600'
                : step.status === 'failed'
                  ? 'text-rose-600'
                  : 'text-slate-400'
            )}
          >
            {step.status === 'passed' ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : step.status === 'failed' ? (
              <XCircle className="h-4 w-4" />
            ) : step.status === 'running' && running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Circle className="h-4 w-4" />
            )}
          </span>
          <span className={step.status === 'failed' ? 'text-rose-700' : 'text-slate-600'}>{step.label}</span>
        </div>
      ))}
    </div>
  );
}

export function StrategyTestModal({ rule, onClose }) {
  const [state, setState] = useState({ status: 'idle', payload: null, error: '' });
  const start = async () => {
    setState({ status: 'running', payload: null, error: '' });
    try {
      setState({ status: 'success', payload: await runSwitchQuickTest(rule.id), error: '' });
    } catch (error) {
      setState({
        status: 'failed',
        payload: error?.payload || null,
        error: error?.message || '快速测试失败'
      });
    }
  };
  const steps = state.payload?.steps || [];
  const result = state.payload?.result || {};
  const testOperator = result.triggerOperator === 'lte' || rule?.triggerOperator === 'lte' ? 'lte' : 'gte';
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/30 p-3 sm:items-center">
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">快速测试</h2>
            <p className="mt-1 text-sm text-slate-500">立即获取最新行情并运行这条规则。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-6 text-slate-500">
          不会发送正式提醒
          <br />
          不会修改持仓
          <br />
          不会产生交易
        </div>
        {state.status === 'idle' ? (
          <div className="mt-5 flex justify-end gap-2">
            <SwitchButton variant="secondary" onClick={onClose}>
              取消
            </SwitchButton>
            <SwitchButton onClick={start}>开始测试</SwitchButton>
          </div>
        ) : state.status === 'running' ? (
          <>
            <StepList
              steps={[
                { key: 'server', label: '正在连接远端服务器', status: 'passed' },
                { key: 'market', label: '正在获取最新行情', status: 'running' },
                { key: 'rule', label: '正在运行规则', status: 'pending' },
                { key: 'notification', label: '正在验证结果', status: 'pending' }
              ]}
              running
            />
          </>
        ) : (
          <div className="mt-5">
            <div
              className={cx(
                'rounded-xl p-4 text-sm',
                state.status === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
              )}
            >
              <div className="font-bold">{state.status === 'success' ? '测试成功' : '测试未通过'}</div>
              {steps.length ? <StepList steps={steps} /> : null}
              {state.status === 'success' ? (
                <div className="mt-3 space-y-1 text-xs">
                  <div>
                    {testOperator === 'lte' ? '当前切换价差' : '当前最佳切换优势'}{' '}
                    {formatSwitchPercent(result.currentMaxAdvantage)}
                  </div>
                  <div>
                    {testOperator === 'lte'
                      ? `目标：收窄到 ${formatSwitchPercent(result.thresholdValue)} 以内`
                      : '当前持仓比候选基金贵'}
                  </div>
                  <div>提醒条件 {formatSwitchPercent(result.thresholdValue)}</div>
                  <div>当前结果 {result.status === 'triggered' ? '已达到提醒条件' : '尚未触发'}</div>
                  <div>响应时间 {((result.responseTimeMs || 0) / 1000).toFixed(1)} 秒</div>
                </div>
              ) : (
                <div className="mt-3 text-xs">
                  失败环节：{state.payload?.failureStage || 'rule'}
                  <br />
                  错误原因：{state.payload?.error || state.error}
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <SwitchButton variant="secondary" onClick={start}>
                <RotateCcw className="h-4 w-4" />
                重新测试
              </SwitchButton>
              <SwitchButton onClick={onClose}>完成</SwitchButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
