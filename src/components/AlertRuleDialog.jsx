import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Button } from './ui/button';

export function AlertRuleDialog({
  open,
  onClose,
  onSave,
  initialRule = null,
  mode = 'market' // 'market' | 'holding'
}) {
  const [alertType, setAlertType] = useState(initialRule?.alertType || 'gain');
  const [threshold, setThreshold] = useState(initialRule?.threshold || 5);
  const [enabled, setEnabled] = useState(initialRule?.enabled ?? true);
  const [cooldownHours, setCooldownHours] = useState(initialRule?.cooldownHours || 24);
  const [priceBase, setPriceBase] = useState(initialRule?.priceBase || 'daily'); // 'daily' | 'alert-day'
  const isOtcFund = mode === 'market' && ['otc', 'qdii'].includes(String(initialRule?.fundKind || initialRule?.kind || '').toLowerCase());

  useEffect(() => {
    if (!open) return;
    const nextAlertType = initialRule?.alertType || 'gain';
    setAlertType(isOtcFund && (nextAlertType === 'premium' || nextAlertType === 'premium-below') ? 'gain' : nextAlertType);
    setThreshold(initialRule?.threshold || 5);
    setEnabled(initialRule?.enabled ?? true);
    setCooldownHours(initialRule?.cooldownHours || 24);
    setPriceBase(initialRule?.priceBase || 'daily');
  }, [open, mode, initialRule?.id, initialRule?.symbol, initialRule?.alertType, initialRule?.threshold, initialRule?.enabled, initialRule?.cooldownHours, initialRule?.priceBase, isOtcFund]);

  const alertTypeOptions = mode === 'market'
    ? (isOtcFund ? [
        { value: 'gain', label: '涨幅超过' },
        { value: 'loss', label: '跌幅超过' }
      ] : [
        { value: 'gain', label: '涨幅超过' },
        { value: 'loss', label: '跌幅超过' },
        { value: 'premium', label: '溢价率超过' },
        { value: 'premium-below', label: '溢价率低于' }
      ])
    : [
        { value: 'gain', label: '持仓涨幅超过' },
        { value: 'loss', label: '持仓跌幅超过' }
      ];

  const showPriceBaseOption = mode === 'market' && (alertType === 'gain' || alertType === 'loss');
  const holdingTrigger = useMemo(() => {
    if (mode !== 'holding') return null;
    const cost = Number(initialRule?.holdingCost);
    const pct = Number(threshold);
    if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(pct) || pct < 0) return null;
    const triggerPrice = alertType === 'loss' ? cost * (1 - pct / 100) : cost * (1 + pct / 100);
    if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) return null;
    return { cost, triggerPrice, direction: alertType === 'loss' ? '跌到或低于' : '涨到或高于' };
  }, [alertType, initialRule?.holdingCost, mode, threshold]);

  const handleSave = () => {
    const config = {
      alertType,
      threshold: Number(threshold),
      enabled,
      cooldownHours: Number(cooldownHours)
    };
    if (showPriceBaseOption) {
      config.priceBase = priceBase;
    }
    onSave(config);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'market' ? '设置市场预警' : '设置持仓预警'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <Label>预警类型</Label>
            <select
              value={alertType}
              onChange={(e) => setAlertType(e.target.value)}
              className="w-full mt-1 px-3 py-2 border rounded-md bg-white"
            >
              {alertTypeOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <Label>阈值（%）</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              max="100"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="例如：5"
            />
            <p className="text-sm text-gray-500 mt-1">
              当{alertTypeOptions.find(o => o.value === alertType)?.label} {threshold}% 时触发通知
            </p>
          </div>

          {holdingTrigger ? (
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              当前持仓成本 ¥{holdingTrigger.cost.toFixed(3)}，规则会在净值{holdingTrigger.direction} ¥{holdingTrigger.triggerPrice.toFixed(3)} 时触发。
            </div>
          ) : null}

          {showPriceBaseOption && (
            <div>
              <Label>涨跌幅计算基准</Label>
              <select
                value={priceBase}
                onChange={(e) => setPriceBase(e.target.value)}
                className="w-full mt-1 px-3 py-2 border rounded-md bg-white"
              >
                <option value="daily">相对前一交易日收盘价（每日重置）</option>
                <option value="alert-day">相对设置预警当天收盘价（固定基准）</option>
              </select>
              <p className="text-sm text-gray-500 mt-1">
                {priceBase === 'daily'
                  ? '每天计算相对昨日收盘的涨跌幅'
                  : '始终相对设置预警时的收盘价计算涨跌幅'}
              </p>
            </div>
          )}

          <div>
            <Label>通知频率</Label>
            <select
              value={cooldownHours}
              onChange={(e) => setCooldownHours(e.target.value)}
              className="w-full mt-1 px-3 py-2 border rounded-md bg-white"
            >
              <option value="1">每小时一次</option>
              <option value="6">每6小时一次</option>
              <option value="24">每天一次</option>
              <option value="168">每周一次</option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <Label>启用预警</Label>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4"
            />
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={handleSave}>保存</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
