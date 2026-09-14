// Temporary source transform for the CN build. Keeps the existing page UI intact
// while routing add-plan persistence through the account item CRUD API.
export function tradePlanCrudTransform() {
  return {
    name: 'trade-plan-account-crud',
    enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('/src/pages/NewPlanExperience.jsx')) {
        let next = code
          .replace(
            "import { syncTradePlanRules } from '../app/notifySync.js';",
            "import { putAccountResourceItem } from '../app/accountApi.js';"
          )
          .replace('    persistPlanState({\n', '    const persisted = persistPlanState({\n')
          .replace(
            '      await syncTradePlanRules();',
            "      await putAccountResourceItem('plans/store', persisted.id, persisted);"
          )
          .replace('本次提醒规则未同步。', '本次账号数据同步失败。')
          .replace('提醒规则已同步。', '已保存到账号。');
        return next === code ? null : { code: next, map: null };
      }

      if (id.endsWith('/src/pages/NewPlanSelectionCards.jsx')) {
        const allowedFilter = ".filter((entry) => entry.code === 'nas-daq100' || entry.code === '^NDX' || /^\\d{6}$/.test(String(entry.code || '')))";
        let next = code
          .replace('helper="可搜索纳指 ETF，或使用美股快捷分组。"', 'helper="仅支持 NDX 和 A股相关基金。"')
          .replace('placeholder="搜索代码或名称，例如 QQQ / 513100 / 纳指"', 'placeholder="搜索 NDX 或 A股基金代码/名称，例如 513100"')
          .replace('输入代码或名称筛选标的，下方也可使用快捷标的按钮。', '输入 NDX 或 A股相关基金的代码或名称进行筛选。')
          .replace(/\n            <details className="mb-3[\s\S]*?\n            <\/details>/, '')
          .replace(
            '纳指 ETF 下拉 · {filteredMarketEntries.length}/{marketEntries.length}',
            `可选标的 · {filteredMarketEntries${allowedFilter}.length}/{marketEntries${allowedFilter}.length}`
          )
          .replace(
            'const opts = filteredMarketEntries.map((entry) => ({',
            `const opts = filteredMarketEntries${allowedFilter}.map((entry) => ({`
          )
          .replace(/\n                    const sym = String\(state\.symbol \|\| ''\)\.trim\(\);[\s\S]*?\n                    }\n                    return opts;/, '\n                    return opts;');
        return next === code ? null : { code: next, map: null };
      }

      if (id.endsWith('/src/pages/TradePlansExperience.jsx')) {
        let next = code
          .replace(
            "import { clearWorkspaceReturn, readWorkspaceReturn } from '../app/workspaceReturn.js';",
            "import { clearWorkspaceReturn, readWorkspaceReturn } from '../app/workspaceReturn.js';\nimport { deleteAccountResourceItem } from '../app/accountApi.js';"
          )
          .replace('  function handleDeletePlanRow(row) {', '  async function handleDeletePlanRow(row) {')
          .replace(
            "      const removed = deletePlan(row.sourceId);\n      if (!removed) return;\n      showActionToast('删除加仓计划', 'success');",
            "      const removed = deletePlan(row.sourceId);\n      if (!removed) return;\n      try {\n        await deleteAccountResourceItem('plans/store', row.sourceId);\n      } catch {\n        showActionToast('账号数据同步失败', 'warning', { description: '加仓计划已从本地删除。' });\n      }\n      showActionToast('删除加仓计划', 'success');"
          );
        return next === code ? null : { code: next, map: null };
      }

      return null;
    }
  };
}
