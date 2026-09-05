/**
 * 把 beta 计划 tab 绑到正式版的两套计划存储上。
 *
 * 读的就是正式版在用的同两份 localStorage，不另开一份：
 * 切回正式版看到的计划与 beta 一致。只读不写。
 */

import { readDcaStore } from '../../app/dca.js';
import { readPlanStore } from '../../app/plan.js';
import { createPlansScreenController } from './plansScreenCore.js';

export const plansScreenController = createPlansScreenController({
  readDcaPlans: () => {
    const store = readDcaStore();
    return { plans: store.plans, activeId: store.activeDcaId };
  },
  readLayeredPlans: () => {
    const store = readPlanStore();
    return { plans: store.plans, activeId: store.activePlanId };
  }
});

/** 读一次两套计划。 */
export function loadPlansScreen() {
  return plansScreenController.load();
}

export default plansScreenController;
