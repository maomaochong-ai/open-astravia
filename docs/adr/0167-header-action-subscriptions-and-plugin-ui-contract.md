# ADR-0167：顶栏订阅收敛与插件可用 UI 组件合同

## 状态

已接受。对应 ADR-0157 登记表 B8 的 `3cnb`（剩余部分）与 B9 的 `egco`。

## 背景

这两条都属于「已经做了一半、剩下的部分会变成长期合同」的收尾：

1. `3cnb` 的前两项（探针按签名去重发布、按钮组关掉背景模糊）已随 B2 落地。剩下的是
   `useActiveConversation()` 仍订阅整个 `activeSessionAtom`。顶栏动作探针是**常驻**的：
   每个注册了顶栏动作的插件都挂着一个，会话对象一换实例它们就全部重渲一次。上游在
   `2e2d5df56` 里把它拆成三个派生 atom，本仓只补了 `activeSessionCwdAtom` 一个。
2. `egco` 的上游改动让插件能用宿主设置页那套皮肤（`MotionSelect`、
   `SettingSection`、`SettingRow`、`SettingHeading`）。本仓 `@astravia-org/ui` 的
   `ButtonGroup` / `Button variant="field"` 插件已可用，但 `theme-ui/plugin-ui` 这份
   出口清单里没有设置页组件，插件只能自绘下拉与分区——设置页与插件设置页因此会漂移，
   同一款「无边框底色下拉」被实现两遍。

## 决策

### 1. `useActiveConversation()` 只订阅它真正返回的字段

在 `shared/store/chat-atoms.ts` 补两个派生 atom：`activeSessionRuntimeIdAtom`、
`activeSessionPathAtom`，与既有的 `activeSessionCwdAtom` 同一写法和同一理由
（`selectAtom` 对选中值做 `Object.is` 比较，会话对象换实例但字段没变时不触发订阅方）。
bridge 的 `useActiveConversation` 改为分别订阅 `runtimeId` / `cwd` / `sessionPath`
（另有 `selectedModelAtom`、`isStreamingAtom`），再用这五个值 `useMemo` 组装返回值。

**不**把 `ConversationState` 整体也做成一个 atom：它跨会话与模型的组合，做成 atom 等于
再引入一份派生状态，而消费方本来就要按字段重渲。

### 2. `plugin-ui` 开放四个设置页组件

在 `packages/theme-ui/src/plugin-ui/index.ts` 增加导出：`MotionSelect`（含
`MotionSelectOption` / `MotionSelectProps`）、`SettingSection`、`SettingRow`、
`SettingHeading`（含类型）。与既有条目同一约束：**纯展示、数据与文案由调用方提供**。

这批组件进清单的理由是它们已经被三处设置页复用、且形态稳定（设置项行高 41px、
无边框底色下拉），插件自绘只会得到第二种近似实现。相反，**不**开放业务视图
（`AppearanceSettingsView` 之类）：那些带具体数据源与写回逻辑，属于宿主功能而非形态。

因为出口清单一旦扩大就成为长期维护的 props 合同，同批补一条出口清单守卫测试：
`plugin-ui` 的导出集合必须与清单常量逐项相等，新增或删除都必须显式改清单——
防止后续有人顺手把业务组件挂上去。

### 3. 插件文档补两节

`docs/plugin/styling-and-pitfalls.md` 增「可用组件速查」（`Button` 的 variant/size、
`ButtonGroup*`、`DropdownMenu*`、`Select*`、`Popover`/`Dialog` 与本次四个组件）与
「设置页同款组件的用法」两节，写明：组件随宿主发布、旧宿主可能没有该导出（插件需
按 `pluginApiVersion` 声明自己用到的最低档）。

## 备选方案

- **让插件直接依赖 `@astravia-org/theme-ui`**：Module Federation 共享域里只有
  `ui` 与 `plugin-sdk`，整包开放等于把设置、能力页、会话等全部业务视图都变成合同，
  与 `plugin-ui` 有意收窄的原则冲突。
- **插件继续自绘下拉**：现成的两个外置插件已经各自写过一次近似下拉，样式与键盘行为
  都不一致；这正是 `egco` 要消除的重复。
- **给 `useActiveConversation` 加一个「只返回 id/cwd」的精简重载**：等于让插件自己选
  两套 API，而字段就五个，直接收敛订阅更简单。

## 后果

- 正面：流式与会话对象替换时，插件顶栏探针不再跟着重渲；插件能直接用宿主皮肤，
  设置页与插件设置页的形态只有一处实现。
- 代价：`plugin-ui` 的公共 props 面变大（四个组件 + 三个类型），改这些组件的 props
  会同时影响外置插件；出口清单守卫测试需要随每次有意变更同步维护。
- 兼容性：`useActiveConversation` 的返回类型与语义不变，仅订阅粒度变细；插件侧无迁移。

## 验证

- `apps/desktop/src/renderer/domains/plugins/runtime/plugin-header-action.test.tsx`：
  既有热更新、promote、窄窗用例回归通过；新增「`activeSessionAtom` 换成字段相同的新
  对象时探针不重新发布」的断言。
- `packages/theme-ui/src/plugin-ui/exports.test.ts`：出口集合与清单常量一致。
- `bun run check:quick -- <改动文件>`；`bun run test:impact -- <改动文件>`。
