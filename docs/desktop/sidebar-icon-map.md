# 侧边栏图标语义映射表（solar linear 内差异化）

> 配套决策见 [ADR-0058](../adr/0058-sidebar-icon-differentiation.md)。
> 范围：桌面端**侧边栏**（主导航 + 更多导航 + 项目列表/新建面板 + 会话状态 + 顶栏更新徽标 + 主题快捷区）。设计规范基线：[DESIGN.md §6.1](../../packages/desktop-app/DESIGN.md)（solar linear 优先、禁止引入其他 collection）。
> 本表为侧边栏图标「现状 → 目标」的唯一权威映射：更换/新增图标时照此执行，不自行另选。

## 已更换项（13 处字形）

| 槽位 | 位置 | 语义 | 原字形 | 新字形 | 路径相似度 |
| --- | --- | --- | --- | --- | --- |
| 主导航-新会话 | `useSidebarModel.ts` | 新建会话（圆形笔，去掉方形衬底） | `pen-new-square-linear` | `pen-new-round-linear` | 低（方/圆衬底可辨） |
| 主导航-自动化 | `useSidebarModel.ts` | 自动循环执行（魔法棒 → 循环箭头） | `magic-stick-3-linear` | `repeat-linear` | 低 |
| 主导航-知识库 | `useSidebarModel.ts` | 文档知识（整排书架 → 单册带书签） | `library-linear` | `book-bookmark-linear` | 低 |
| 主导航-能力 | `useSidebarModel.ts` | AI 技能/能力（宫格 → 星光） | `widget-5-linear` | `star-shine-linear` | 低 |
| 更多-批量任务 | `useSidebarModel.ts` | 任务批次列表（单勾 → 列表行） | `clipboard-check-outline` | `clipboard-list-linear` | 0% |
| 更多-模型设置 | `useSidebarModel.ts` | 模型/服务端配置（闪电 CPU → 服务器机架） | `cpu-bolt-linear` | `server-linear` | 低 |
| 更多-Agent 设置 | `useSidebarModel.ts` | Agent 档案/身份（说话人头像 → 人像+ID 卡） | `user-speak-rounded-linear` | `user-id-linear` | 低 |
| 更多-外观 | `useSidebarModel.ts` | 外观设置（圆角调色盘变体） | `palette-linear` | `palette-round-linear` | 低 |
| 会话状态-定时 | `SessionStatusIcon.tsx` | 已定时/延时会话（圆钟 → 方钟） | `clock-circle-linear` | `clock-square-linear` | 低 |
| 顶栏徽标-待重启 | `SidebarUpdateIcon.tsx` | 更新完成待重启（方形线框族） | `restart-linear` | `restart-square-linear` | 低 |
| 顶栏徽标-可下载 | `SidebarUpdateIcon.tsx` | 有新版本可下载（方形线框族） | `download-linear` | `download-square-linear` | 低 |
| 顶栏徽标-出错 | `SidebarUpdateIcon.tsx` | 更新失败（方形线框族，与上两态同族） | `danger-circle-linear` | `danger-square-linear` | 低 |
| 主题快捷区标头 | `SettingsMenuThemeSection.tsx` | 主题（与「外观」导航同字形） | `palette-linear` | `palette-round-linear` | 低 |

## 保留项（有意不做换形）

| 图标 | 槽位 | 保留理由 |
| --- | --- | --- |
| `database-linear` | 数据库入口导航 | solar 内数据库语义唯一字形；并对 ADR-0057 B4 修订——该入口维持 solar，不再换 lucide |
| `widget-2-linear` | 插件视图回退图标 | 插件动态视图的通用兜底，避免语义绑定 |
| `widget-4-linear` | 侧栏筛选视图下拉 | 需「筛选视图」语义，solar 无更贴切字形 |
| `folder-linear` | 项目分组-普通组标头 | DESIGN.md §6.1 canonical；`folder-2` 相似度 91% 换形无意义 |
| `layers-minimalistic-linear` | 项目分组-批量组标头 | `layers-linear` 相似度 49%，属换名不换形 |
| `folder-open-linear` / `add-folder-linear` / `import-linear` | 新建/打开项目面板 | 语义唯一或 canonical |
| `add-circle-linear` / `add-square-outline` | 新建/添加动作 | canonical；加号语义无必要换形 |
| `settings-linear` | 头像菜单-设置 | canonical 通用符号 |
| `sun-linear` / `moon-linear` / `laptop-linear` | 主题切换三态 | OS/用户惯例符号，刻意换形伤可识别性；实测 `moon-stars` 与 `moon` 路径 100% 相同无字可换 |
| `chat-round-line-linear` | 会话状态-空闲 | DESIGN.md §6.1 canonical（会话语义） |
| `refresh-linear` | 会话状态-运行中 | canonical + `animate-spin` 旋转惯例 |
| `clock-square-linear` 之外的 `check-circle-*`、`documents-minimalistic-linear`、`user-circle-linear` 等 | 侧栏内状态/辅助位 | 通用反馈符号，非上游雷同高发区 |

## 相似度验证方法（更换前必跑）

solar 图标包路径（monorepo 根执行）：

```bash
node -e '
const fs=require("fs");
const j=JSON.parse(fs.readFileSync("packages/desktop-app/node_modules/@iconify-json/solar/icons.json","utf8"));
const norm=s=>s.body.replace(/fill="[^"]*"/g,"").replace(/stroke="[^"]*"/g,"");
const sim=(a,b)=>{const x=norm(j.icons[a]).replace(/<path/g,"\n<path");const y=norm(j.icons[b]).replace(/<path/g,"\n<path");
let m=0;for(const l of x.split("\n")){if(y.includes(l))m+=l.length;}
return Math.round(m/Math.min(x.length,y.length)*100);};
console.log(sim("<现状名>","<候选名>")+"%");
'
```

判定：**相似度 ≥ 50% → 换名不换形，淘汰该候选**（实测反例见 ADR-0058 第 3 条）。

## 治理边界

- 数据库工作台**内部**（`renderer/domains/database/*`）仍按 [ADR-0057](./0057-database-workspace-icon-standardization.md) 使用 lucide，不受本表约束；本表只约束侧边栏。
- 若未来启用自绘品牌图标集（v2 方向），本表「语义」列即映射基线。
