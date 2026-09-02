# Desktop UI 组件设计与组合规范

本文是 Desktop 创建、修改和审查 UI 组件时的项目级规范。它用于选择与真实变化维度匹配的组件合同，而不是要求所有组件都套用同一种模式。目标不是消灭 props，也不是把所有 UI 都改成 Compound Components；目标是让数据、状态、行为、布局和视觉拥有清晰边界，并在需要结构扩展时优先通过 JSX 组合表达。

## 1. 什么是可组合

可组合组件把一个界面拆成可以独立挂载、删除、替换、排序和复用的语义部件。调用方能从 JSX 直接看出最终结构，不需要同时理解父组件里的功能开关、区域映射或隐藏分支。

```tsx
<Search.Root>
	<Search.Input />
	<Search.Clear />
	<Search.Results>
		<Search.Empty />
	</Search.Results>
</Search.Root>
```

可组合不等于“组件没有 props”。下面这些仍是正常合同：

- 数据：`items`、`value`、`label`、`count`、`status`；
- 受控状态：`open`、`onOpenChange`、`checked`、`onCheckedChange`；
- 行为约束：`disabled`、`required`、`forceMount`；
- 原生元素属性、事件、`className`、`style`、`aria-*`、`data-*`；
- 动态集合的 `children(item)`，前提是它只负责逐项映射，不决定静态能力和区域。

下面这些不是可组合合同：

```tsx
<Panel
	showSearch
	showFooter
	leftActions={<Actions />}
	renderBody={() => <Body />}
	sections={{ header: <Header />, content: <Content /> }}
/>
```

这些 prop 决定“有什么”和“放在哪里”，会迫使父组件随着每个新需求持续增长。应改为显式子组件：

```tsx
<Panel.Root>
	<Panel.Header>
		<Panel.Search />
	</Panel.Header>
	<Panel.Body />
	<Panel.Footer>
		<Actions />
	</Panel.Footer>
</Panel.Root>
```

选择合同应遵循从简单到复杂的顺序：

1. 单一职责视觉或行为叶子：普通组件和明确 props；
2. 只需要包裹内容的容器：普通 `children`；
3. 存在多个真实组合维度或共享行为：Compound Components；
4. 由插件、服务端或配置在运行时生成的界面：经过校验的动态描述，再投影为公开 Primitive。

不要为了形式统一，把稳定且没有组合需求的叶子拆成 namespace；也不要因为当前只有一个调用方，就把已经存在的多个变化维度封死在父组件中。

## 2. 何时使用 Compound Components

满足任一条件时，应优先考虑 Radix 风格 Compound API。只有存在共享状态、行为或必要语义边界时才引入 `Root`；无共享边界的能力可以只是同一 namespace 下的独立叶子：

- 有两个及以上能力可以独立增删、替换或排序；
- 同一状态或行为需要附着到不同宿主元素；
- 同一基础布局要服务多个页面、产品场景或扩展来源；
- 新需求开始引入 `showX`、`enableX`、`renderX`、`*Slot`、`left*`、`right*` 或多个 `ReactNode` prop；
- 调用方必须修改组件内部代码，才能更换一个区域或插入一个能力。

单一职责的叶子组件，例如头像、徽标、格式化时间、图标按钮，可以继续使用普通 props。不要为了形式创建没有共享状态、没有组合维度的空 `Root`。

### 2.1 Radix 风格的实质：能力组合，不是命名组合

Radix 的 `Root/Trigger/Content/Title/Close` 并不是把若干 DOM 标签放进同一 namespace。每个 Part 都承担可以独立验证的职责：

- `Root` 管理受控/非受控状态、共享引用和关联 ID；
- `Trigger` 把状态、ARIA、ref 和触发事件附着到交互宿主；
- `Content` 负责挂载生命周期、焦点、dismiss、portal 或定位等行为；
- `Title` / `Description` 使用正确的默认语义，并与 Content 建立可访问关系；
- `asChild` / `Slot` 只是把上述真实能力合并到调用方宿主，不会凭空产生组合能力。

因此，公开 Part 至少应拥有以下一种真实职责：

1. 读取或改变共享行为状态；
2. 建立可访问语义或元素间关系；
3. 管理焦点、键盘、dismiss、presence、portal、定位等生命周期；
4. 定义可复用且允许替换内容的布局位置；
5. 提供稳定、可独立使用的视觉或交互合同；
6. 将上述属性、事件和 ref 投影到调用方选择的宿主。

如果一个 Part 只做以下事情，它不是有效的 Compound Primitive：

- 只检查自己是否位于某个 Context 内，却不消费任何共享能力；
- 只添加 `data-*` 标记，且生产样式、行为、可访问性和扩展机制均不使用该标记；
- 只生成无样式、无语义、无行为的 `div` 包装层；
- 只为了组成 `Namespace.Part` 的外形而通过工厂批量生成组件；
- 只在测试中证明 marker 存在，而没有证明行为、语义或替换能力；
- 给所有 Part 机械添加 `asChild`，但没有需要投影到宿主的能力。

这种做法称为“名义组合”（nominal composition）：API 看起来像 Radix，实际仍只是组件别名或 DOM 包装。它增加层级、Context 约束和测试负担，却没有降低调用方扩展成本，属于应避免的错误方向。

组件工厂本身不是问题，但只能用于消除已经成立的真实合同之间的机械重复。使用 `createPart`、`createPrimitive` 等工厂前，必须先逐个证明生成的公开 Part 具有独立职责，并为每类 Part 保留正确的默认元素、props 类型和可访问语义；不能先有工厂，再为工厂制造组件。

参考实现：

- [Radix Composition 指南](https://www.radix-ui.com/primitives/docs/guides/composition)
- [Radix Slot 文档](https://www.radix-ui.com/primitives/docs/utilities/slot)
- [Radix Dialog 源码](https://github.com/radix-ui/primitives/blob/main/packages/react/dialog/src/dialog.tsx)
- [Radix Slot 源码](https://github.com/radix-ui/primitives/blob/main/packages/react/slot/src/slot.tsx)

## 3. 按四个轴拆分

复杂 UI 应先从以下四个轴分析职责，避免产生“大 View”。它们是分析和依赖方向，不要求每个组件都建立四套文件、组件或 Context；没有相应职责时应直接省略该层。

### 3.1 Behavior：状态与交互语义

Behavior Root 只拥有真正共享的状态，例如 `open/query/selection`，并通过最小 Context 提供给 `Trigger`、`Close`、`Search` 等部件。优先不产生 DOM。

- 支持受控和非受控状态时，使用 Radix 习惯的 `value/defaultValue/onValueChange` 或 `open/defaultOpen/onOpenChange`；
- 每个 Primitive 只读取自己需要的 Context 字段；
- 离开 Root 使用时立即抛出包含部件名称的错误；
- 单个能力独有的状态、副作用和数据留在该能力内部，不进入万能 Context；
- Escape、焦点、点击外部关闭等行为属于明确能力，应由对应 Primitive 或 Behavior Root 拥有。

### 3.2 Layout：DOM 结构和位置

布局使用语义容器表达，例如 `Header`、`Body`、`Footer`、`Leading`、`Trailing`、`Rail`、`PanelPositioner`。布局层不读取业务 atom、不调用 IPC，也不判断某项产品能力是否存在。

布局部件必须允许调用方通过增加、删除或移动 JSX 改变组合。不得用 `position="left"`、字符串 region、中央区域数组或父组件映射表控制静态布局。

### 3.3 Visual：视觉叶子

视觉层包含 bubble、surface、tick、entry、badge 等可替换叶子。它可以接收视觉状态和原生属性，但不得拥有业务数据加载、产品能力开关或固定整个页面结构。

状态样式优先使用 `aria-*` / `data-state`：

```tsx
<Navigation.Trigger data-state="open" />
<Navigation.Entry aria-current="location" />
```

### 3.4 Recipe / Connector：具体产品组合

Recipe 是项目提供的默认 JSX 组合，可以固定某个产品场景的 DOM 顺序和样式；它不是底层 Primitive，也不是唯一入口。其他场景可以完全替换 Recipe，或直接使用公开 Primitive 重新组合。

Connector 负责 atom、IPC、i18n、数据模型和事件适配，再把数据传入 Recipe 或业务 JSX。不要把 Connector 的业务状态塞进 theme-ui Context。

```text
业务状态 / i18n / IPC
          ↓
Connector 或 useModel
          ↓
Recipe（默认 JSX 组合，可替换）
       ↙                 ↘
Behavior primitives     Layout / Visual primitives
```

## 4. `asChild` 合同

行为或样式需要附着到调用方提供的宿主元素时，必须提供 `asChild`，并使用 Radix `Slot` 合并属性，避免无意义包装层。

```tsx
<Dialog.Trigger asChild>
	<Button>打开</Button>
</Dialog.Trigger>
```

实现要求：

- `ref` 必须转发到最终宿主；
- `className`、事件、`aria-*` 和 `data-*` 必须正确合并；
- 内部事件不得无条件覆盖调用方事件；调用方 `preventDefault()` 后应停止默认内部动作；
- 默认宿主必须有正确语义，例如 Trigger 默认使用 `button type="button"`；
- `asChild` 后不得向非 button 宿主泄漏 `type="button"` 等无效属性；
- 不要仅为套样式强制增加 `div`。

## 5. Props 审查规则

判断一个 prop 是否合理时，问：它是在描述数据/状态，还是在远程编排子树？

| 可以保留 | 必须改为组合 |
| --- | --- |
| `value`, `open`, `active`, `status` | `showToolbar`, `enableSearch` |
| `onValueChange`, `onOpenChange` | `renderToolbar`, `toolbarSlot` |
| `items`, `count`, `label` | `header: ReactNode`, `footer: ReactNode` |
| `disabled`, `required`, `forceMount` | `leftActions`, `rightActions` |
| 原生 DOM props 和 a11y props | `regions`, `sections`, `features` 万能对象 |
| 集合的函数 children | 静态功能注册表或字符串 region |

例外必须同时满足：

1. 它是运行时插件或服务端下发的真实动态集合；
2. 边界层会校验动态描述；
3. 描述会被转换为公开 Primitive；
4. 它不会反向成为内置静态能力的唯一配置源。

`children` 本身不是自动合格的组合 API。若父组件仍解析 children 的类型、把它们重新分配到固定区域，或要求在另一处注册能力，仍然属于中央编排。

## 6. 命名与公开 API

- Namespace 名称描述稳定概念，例如 `Toolbar`、`Navigation`、`Search`，不要使用与实际职责不一致的名称；
- Primitive 名称描述语义：`Root`、`Trigger`、`Content`、`Close`、`Header`、`Body`，不要使用 `Part1`、`SlotA`；
- 行为、布局和视觉同名时用明确 namespace 区分，不用一个巨型组件同时负责三者；
- 保留 named export 便于测试和按需使用，同时提供 namespace object 改善调用体验；
- 不保留把旧 API 翻译成新 API 的永久兼容层。公共包、第三方扩展或跨版本兼容确需迁移窗口时，应明确兼容范围、弃用方式、移除条件和验证策略。

## 7. 组件演进与行为保持

创建新组件时应明确语义、交互、可访问性和扩展边界；修改现有组件时，“改成可组合”本身不授权改变现有功能或样式。涉及合同或结构调整时，应在变更前后逐项核对：

- DOM 语义、可访问名称和 `aria-*`；
- class、尺寸、间距、颜色、响应式和层级；
- 键盘、焦点、hover、点击外部和快捷键；
- 动画、mount/unmount 时机和列表滚动；
- 事件触发顺序、受控状态和业务回调；
- 空状态、加载、错误、只读和插件场景。

不要顺手“优化”视觉或删功能。确需产品变化时，作为独立变更说明并单独验证。

## 8. 创建或修改 UI 组件的工作流程

每次创建或修改 Desktop UI 组件，实施者应按变更规模完成适用步骤。简单叶子不需要虚构布局层、Recipe 或 Context，但仍需审查语义、props、可访问性和复用边界：

1. 列出组件可独立变化的能力、共享状态和布局区域；
2. 判断它是 leaf、Behavior、Layout、Visual、Recipe 还是 Connector；
3. 搜索现有 Primitive 和 recipe，确认没有重复造轮子；
4. 审查新增或发生语义变化的 prop，不新增不必要的结构 prop 和能力开关；
5. 只有在行为或样式确实需要附着到调用方宿主时才实现 `asChild`，并验证其合同；
6. 修改现有合同需保持既有功能、DOM 和视觉；根据影响范围选择原子迁移或有期限的兼容迁移；
7. 完成本节后的自审清单和适用测试；
8. 交付时说明组合边界、删除的旧合同、审查结果和未运行的验证。

### 自审清单

- [ ] 增加、删除、替换、排序一项静态能力只需要修改调用方 JSX；
- [ ] 没有新增 `showX/enableX/renderX/*Slot/leftActions/rightActions`；
- [ ] 没有用任意 `ReactNode` prop 远程填充区域；
- [ ] Root Context 只包含共享状态，不是业务 view model；
- [ ] Behavior、Layout、Visual、Recipe、Connector 职责没有混在一个组件；
- [ ] `asChild` 的宿主、ref、事件和 a11y 合同正确；
- [ ] Primitive 离开 Root 时有明确错误；
- [ ] 每个公开 Part 都有可说明、可测试的行为、语义、布局、视觉或宿主投影职责；
- [ ] 没有为了 namespace 外形、`data-*` marker 或复用工厂而创建名义 Primitive；
- [ ] API 演进策略与影响范围匹配；不存在无期限、无移除条件的双轨实现；
- [ ] DOM、样式、键盘、焦点、动画和事件行为未意外变化；
- [ ] 已覆盖能力独立增删/排序、Context、`asChild` 和实际业务交互。

## 9. 审查现有组件

审查时按严重度报告：

- P1：组件合同已阻止重要场景实现，或迫使多个场景复制实现并造成用户能力缺失；
- P2：父组件通过开关、ReactNode region 或固定结构持续吸收独立能力，扩展必须反复修改中央组件；
- P3：叶子职责、命名或 Context 边界不清，但暂未阻止组合。

建议先用文本搜索发现候选，再逐个判断语义，不能把命中结果直接当结论：

```powershell
rg -n "show[A-Z]|enable[A-Z]|render[A-Z]|ReactNode|Slot\??:|leftActions|rightActions" `
	apps/desktop/src/renderer packages/theme-ui/src -g "*.tsx"
```

审查结论必须包含组件、具体合同、受阻场景和建议边界。当前变更新引入或直接加重的问题必须在交付前修复；与当前目标无关的历史问题应按影响记录为后续项，不能借规范无限扩大改动范围，也不能声称未审查的范围已经符合规范。

## 10. 测试最低要求

- Behavior：受控/非受控状态、Context 缺失以及适用的触发、关闭、选择、输入等交互；
- Composition：能力可独立省略、替换和改变顺序；
- `asChild`：最终宿主类型、ref、class、事件合并、`aria-*`/`data-state`；
- Part 存在性：测试其真实职责，不以 namespace、包装层或 `data-*` marker 本身作为通过条件；
- Recipe：目标场景的 DOM、可访问名称、键盘和关键交互保持；
- 业务场景：只测试各自实际组合和公开合同，不依赖其他场景的内部实现。

本规范不记录某次功能迁移的具体组件清单。领域特有的组件边界、迁移范围和兼容决策应记录在对应 ADR 中；ADR 是场景决策，不扩大本规范的强制范围。
