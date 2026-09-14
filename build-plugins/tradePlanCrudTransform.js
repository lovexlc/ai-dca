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
