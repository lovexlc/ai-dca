import{c as i,n as d,j as e,P as x,a as h,o as m,s as g,p as y,A as c,b as n,q as p,C as j,d as N,G as o,H as w,u,m as b,R as f}from"./app-BhohoCG0.js";/**
 * @license lucide-react v1.7.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const v=[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]],k=i("external-link",v);/**
 * @license lucide-react v1.7.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _=[["rect",{width:"7",height:"7",x:"3",y:"3",rx:"1",key:"1g98yp"}],["rect",{width:"7",height:"7",x:"14",y:"3",rx:"1",key:"6d4xhi"}],["rect",{width:"7",height:"7",x:"14",y:"14",rx:"1",key:"nxv5o0"}],["rect",{width:"7",height:"7",x:"3",y:"14",rx:"1",key:"1bb6yr"}]],E=i("layout-grid",_);/**
 * @license lucide-react v1.7.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const M=[["rect",{width:"20",height:"14",x:"2",y:"3",rx:"2",key:"48i651"}],["line",{x1:"8",x2:"16",y1:"21",y2:"21",key:"1svkeh"}],["line",{x1:"12",x2:"12",y1:"17",y2:"21",key:"vw1qmm"}]],R=i("monitor",M);/**
 * @license lucide-react v1.7.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const C=[["rect",{width:"14",height:"20",x:"5",y:"2",rx:"2",ry:"2",key:"1yt0o3"}],["path",{d:"M12 18h.01",key:"mhygvu"}]],L=i("smartphone",C);function P(a){return a.id===w?"./index.html":u(a.id)}function H(){const a=d();return e.jsxs(x,{className:"pb-20",children:[e.jsx(h,{eyebrow:"Catalog",title:m,description:"统一调试入口已经切到 React 多页面架构。这里列出所有可访问页面分组，方便你在 `frontend/catalog.html` 下直接跳转预览。",badges:[e.jsxs(n,{tone:"indigo",children:[p.length," 个页面"]},"pages"),e.jsxs(n,{tone:"slate",children:[a.length," 个分组"]},"groups")],actions:e.jsxs(e.Fragment,{children:[e.jsxs("a",{className:g,href:"./catalog.html",children:["刷新目录",e.jsx(k,{className:"h-4 w-4"})]}),e.jsxs("a",{className:y,href:"./index.html",children:["打开封面",e.jsx(c,{className:"h-4 w-4"})]})]})}),e.jsx("div",{className:"mx-auto max-w-6xl space-y-6 px-6 pt-8",children:a.map(t=>{var l;return e.jsxs(j,{children:[e.jsx(N,{eyebrow:(l=o[t.key])==null?void 0:l.label,title:t.label,description:t.description,action:e.jsxs(n,{tone:"slate",children:[t.screens.length," 页"]})}),e.jsx("div",{className:"mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3",children:t.screens.map(s=>{var r;return e.jsxs("a",{className:"group rounded-[24px] border border-slate-200 bg-slate-50 p-5 transition-all hover:-translate-y-1 hover:bg-white hover:shadow-sm",href:P(s),children:[e.jsxs("div",{className:"flex items-center justify-between gap-4",children:[e.jsxs("div",{className:"inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200",children:[s.device==="MOBILE"?e.jsx(L,{className:"h-3.5 w-3.5"}):e.jsx(R,{className:"h-3.5 w-3.5"}),s.deviceLabel]}),e.jsx(E,{className:"h-4 w-4 text-slate-300 transition-colors group-hover:text-slate-500"})]}),e.jsx("div",{className:"mt-4 font-semibold text-slate-900",children:s.title}),e.jsx("div",{className:"mt-2 text-sm leading-6 text-slate-500",children:(r=o[s.group])==null?void 0:r.description}),e.jsxs("div",{className:"mt-5 flex items-center justify-between gap-4 text-xs text-slate-400",children:[e.jsx("span",{className:"truncate",children:s.id}),e.jsxs("span",{className:"inline-flex items-center gap-1 font-semibold text-indigo-600",children:["打开",e.jsx(c,{className:"h-3.5 w-3.5"})]})]})]},s.id)})})]},t.key)})})]})}b(document.getElementById("root")).render(e.jsx(f.StrictMode,{children:e.jsx(H,{})}));
