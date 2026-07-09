export function pickSwitchSnapshotForRule(snapshot, ruleId) {
  if (!snapshot) return null;
  const rules = Array.isArray(snapshot.rules) ? snapshot.rules : [];
  const matched = rules.find((entry) => {
    const id = String(entry?.ruleId || entry?.id || entry?.snapshot?.ruleId || '').trim();
    return id && id === ruleId;
  });
  if (matched?.snapshot) return matched.snapshot;
  if (matched?.byBenchmark) return matched;
  return snapshot;
}

function compactSwitchEntryCode(value = '') {
  return String(value || '').trim().toUpperCase().slice(0, 24);
}

export function normalizeSwitchEntryAttribution(input = {}) {
  let params = null;
  if (typeof window !== 'undefined') {
    params = new URLSearchParams(window.location.search || '');
  }
  const source = String(input.entrySource || input.source || params?.get('source') || '').trim().slice(0, 60);
  const code = compactSwitchEntryCode(input.notificationCode || input.code || params?.get('code') || '');
  const targetCode = compactSwitchEntryCode(input.notificationTargetCode || input.targetCode || params?.get('targetCode') || '');
  const trigger = String(input.notificationTrigger || input.trigger || params?.get('trigger') || '').trim().slice(0, 60);
  const rule = String(input.notificationRule || input.rule || params?.get('rule') || '').trim().slice(0, 40);
  return {
    entrySource: source,
    notificationCode: code,
    notificationTargetCode: targetCode,
    notificationTrigger: trigger,
    notificationRule: rule,
    fromNotification: Boolean(input.fromNotification || source === 'notification')
  };
}

function isRunnableSwitchRuleForUi(rule) {
  if (!rule?.enabled) return false;
  const benches = Array.isArray(rule.benchmarkCodes) ? rule.benchmarkCodes.filter(Boolean) : [];
  if (!benches.length) return false;
  if (Number(rule.intraBuyOtherPct) <= Number(rule.intraSellLowerPct)) return false;
  const enabled = Array.isArray(rule.enabledCodes) ? rule.enabledCodes.filter(Boolean) : [];
  const benchSet = new Set(benches);
  const hasOtcCandidates = enabled.some((code) => code && !benchSet.has(code));
  const cls = rule.premiumClass || {};
  const pool = Array.from(new Set([...benches, ...enabled])).filter((code) => cls[code] === 'H' || cls[code] === 'L');
  const hasIntraPair = benches.some((code) => {
    const currentClass = cls[code];
    if (currentClass !== 'H' && currentClass !== 'L') return false;
    const opposite = currentClass === 'H' ? 'L' : 'H';
    return pool.some((candidate) => candidate !== code && cls[candidate] === opposite);
  });
  return hasIntraPair || hasOtcCandidates;
}

export function countRunnableSwitchRulesForUi(rules = []) {
  return (Array.isArray(rules) ? rules : []).filter(isRunnableSwitchRuleForUi).length;
}
