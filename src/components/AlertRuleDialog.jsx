import { useState } from 'react';
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

  const alertTypeOptions = mode === 'market'
    ? [
        { value: 'gain', label: '涨幅超过' },
        { value: 'loss', label: '跌幅超过' },
        { value: 'premium', label: '溢价率超过' },
        { value: 'discount', label: '折价率超过' }
      ]
    : [
        { value: 'gain', label: '持仓涨幅超过' },
        { value: 'loss', label: '持仓跌幅超过' }
      ];

  const handleSave = () => {
    onSave({
      alertType,
      threshold: Number(threshold),
      enabled,
      cooldownHours: Number(cooldownHours)
    });
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
