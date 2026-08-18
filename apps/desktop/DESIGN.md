# Desktop-App Renderer 设计规范

> 本文件是 **agent 改动 `src/renderer/**` 任何 UI 时的必读硬性规范**，不是参考手册。
> 单一事实源：`src/renderer/styles.css` 的 CSS 变量与 `@theme inline` 块。
> 任何与本文件冲突的现存代码 = 待清理的债，**不要**当作范例复制。

---

## 0. 触发场景

修改/新增以下任何内容时，先把本文件读完：

- `src/renderer/**/*.tsx`、`src/renderer/**/*.css`
- `shared/components/ui/**`（shadcn 基础件）
- 任何包含 `className=` 的 React 文件
- 任何使用 `motion/react` 的动画

---

## 1. 颜色：MUST 用 token，禁止硬编

### 1.1 唯一合法的颜色来源

只能使用通过 `@theme inline` 暴露的 token 工具类，及其 `/N` alpha 变体：

| 用途       | Token 类                                                         |
| ---------- | ---------------------------------------------------------------- |
| 页面底     | `bg-background` / `text-foreground`                              |
| 卡片面     | `bg-card` / `text-card-foreground`                               |
| 浮层面     | `bg-popover` / `text-popover-foreground`                         |
| 主色       | `bg-primary` / `text-primary` / `text-primary-foreground`        |
| 次要面     | `bg-secondary` / `bg-muted` / `bg-accent`                        |
| 次要文字   | `text-muted-foreground`                                          |
| 边/输入/环 | `border-border` / `bg-input` / `ring-ring` / `outline-ring`      |
| 危险       | `bg-destructive` / `text-destructive` / `text-destructive-foreground` |

Alpha 写法只允许 `/5 /10 /15 /20 /25 /30 /40 /50 /60 /70 /80`，例：`bg-primary/10`、`border-border/40`、`text-muted-foreground/60`。

### 1.2 严禁

- **任何 hex / `rgb()` / `hsl()`、Tailwind 默认调色盘（`slate-*`、`zinc-*`、`gray-*`、`sky-*`、`violet-*`、`pink-*`、`orange-*` 等）**。
- 例外：见 §1.3 语义色白名单。
- 不要写自定义 `style={{ color: '#...'}}`。需要透明混合时使用 `color-mix(in srgb, var(--primary) X%, transparent)`，与现有 `styles.css` 一致。

### 1.3 语义色白名单（仅此三种 Tailwind 原色合法）

| 语义     | 类                                                       | 触发条件                  |
| -------- | -------------------------------------------------------- | ------------------------- |
| 成功/运行 | `bg-emerald-500/15` `text-emerald-400`                   | 已启用、运行中、连接成功  |
| 警告/可更新 | `bg-amber-500/15` `text-amber-400`                       | 版本可更新、待办、超时    |
| 错误     | **必须用 `destructive` token**，禁止 `red-*`             | 删除、失败、不可逆操作    |

其他业务标签色（"自定义"、"实验"、"Beta"）一律用 `bg-primary/10 text-primary` 或 `bg-accent/60 text-muted-foreground`，**不要**引入 `violet-*` / `sky-*` / `pink-*`。

---

## 2. 卡片：默认 0 阴影，靠 border + bg 分层

### 2.0 线条粗细：全局统一 1px

- **所有线条（border、divider、ring、outline）必须是 1px**，全局统一，不允许出现粗细混用。
- 默认即 `border` / `ring-1` / `outline-1`（Tailwind 默认就是 1px），**禁止** `border-2`、`border-4`、`ring-2`、`outline-2` 及以上。
- 禁止 `border-[Npx]` 等任意值；如需"加重"分隔，改用更深的 token 颜色（如 `border-border` 替 `border-border/40`）或叠 `bg-*`，**不要**通过加粗线条来强调。
- 选中态、focus 态也走 `ring-1 ring-inset`，不要用 `ring-2` 增加视觉重量。


### 2.1 卡片基线

```tsx
<div className="rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm transition-colors duration-200 hover:border-primary/40 hover:bg-card/60">
```

- **形状** `rounded-xl`
- **分层** 边框 `border-border/40~60` + 背景 `bg-card/30~60`（可叠 `backdrop-blur-sm`）
- **hover** 只换边框颜色和背景透明度，**不加阴影、不放大、不平移超过 2px**

### 2.2 阴影规则

| 场景                   | 允许                                |
| ---------------------- | ----------------------------------- |
| 普通卡片（list 项、grid 卡） | **无阴影**                           |
| Popover / Dropdown / Dialog | `shadow-md` 或 `shadow-lg`           |
| 拖拽中的元素           | `shadow-lg`                          |
| Toast / floating bar   | `shadow-md`                          |

**禁止：**

- 卡片 hover 添加 `shadow-*`
- 任何 `shadow-[...]` 自定义任意值
- 带 primary 色的发光阴影，如 `shadow-[0_4px_16px_-6px_var(--primary)]`（这种"发光卡片"观感被明确否决）
- 自定义 `--shadow-*` token，沿用 `styles.css` 已有八档

### 2.3 强调态（被选中、活跃 session）

用 `ring` 而不是 `shadow`：`ring-1 ring-inset ring-primary/30`、`bg-primary/10`、`border-primary/40`。

---

## 3. 圆角

| 元素                                                    | 类             |
| ------------------------------------------------------- | -------------- |
| 卡片、面板、grid 卡                                     | `rounded-xl`   |
| 列表项、输入框、按钮（常规 size）                       | `rounded-lg` 或 `rounded-md` |
| 小 chip / 图标块（h ≤ 9）                               | `rounded-lg`   |
| Pill / 标签 / segmented control / 圆形 icon button      | `rounded-full` |
| Hero 区域、超大装饰容器                                 | `rounded-2xl`（仅一处级别的视觉锚点，慎用） |

禁止 `rounded-3xl` 及以上，禁止任意 `rounded-[Npx]`。

---

## 4. 间距与密度

### 4.1 padding 选择

| 容器                                      | padding             |
| ----------------------------------------- | ------------------- |
| 紧凑列表项（h≈40）                        | `px-3 py-2.5`       |
| 标准卡片                                  | `px-3.5 pt-3 pb-3`  |
| 宽松卡片 / 设置面板                       | `p-4`               |
| 页面外层（page container）                | `px-8` + `pb-8`     |
| Popover 内 menu item                      | `px-2.5 py-1.5`     |

### 4.2 grid gap

| 内容                | gap          |
| ------------------- | ------------ |
| 紧凑卡片网格        | `gap-2.5`    |
| 标准卡片网格        | `gap-3`      |
| 大块统计/Section    | `gap-4` ~ `gap-5` |

grid 自适应：`grid-cols-[repeat(auto-fill,minmax(240px,1fr))]`（小卡）/ `minmax(320px,1fr)`（行式列表）。**禁止**写死 `grid-cols-3`。

### 4.3 字号梯度

仅使用以下七档，**不要**自创：`text-[10px]` `text-[11px]` `text-[12px]` `text-[13px]` `text-[14px]` `text-[15px]` `text-[20px]`+（统计数字一类）。

---

## 5. 动画

### 5.1 总则

UI 是工具，不是 showroom。**hover 只反馈，不表演。**

| 场景       | 允许                                                                        |
| ---------- | --------------------------------------------------------------------------- |
| 卡片 hover | `whileHover={{ y: -2 }}` **上限**；不允许 `scale`、`rotate`、`shadow` 联动 |
| 按钮 hover | `whileHover={{ scale: 1.04 }}` 上限                                          |
| 按钮 tap   | `whileTap={{ scale: 0.94 }}` 下限                                            |
| 进入       | `opacity 0→1 + y 8→0` 或 `+ scale 0.97→1`；duration ≤ 0.5s                  |
| stagger    | `staggerChildren: 0.04~0.06`，`delayChildren ≤ 0.15`                         |

### 5.2 spring 默认值

入场用 spring 时统一 `{ type: "spring", stiffness: 280~320, damping: 26 }`，按钮交互 `{ stiffness: 380, damping: 22 }`。

### 5.3 禁止

- 装饰性持续旋转 / 弹跳（loading spinner 除外）
- `whileHover` 同时改 `y` + `scale` + 阴影
- 长于 0.6s 的进入动画
- transition 写 `transition-all`；优先 `transition-colors` 或具体属性

---

## 6. 图标（`@iconify/tailwind4`）

### 6.1 命名

**新增图标一律优先 solar**（`icon-[solar--*-linear]`，统一用 `linear` 线性风格），其次才是 mdi。存量 `icon-[mdi--*]` 渐进迁移，改动相关组件时顺手替换为 solar 同义图标。禁止引入其他 collection（`lucide`、`tabler` 等），避免 collection 蔓延。

solar 常用对照：菜单 `menu-dots`、关闭 `close-circle`、删除 `trash-bin-trash`、编辑 `pen-2`、文件夹 `folder` / `folder-open`、新建 `add-circle` / `add-folder`、设置 `settings`、铃铛 `bell`、会话 `chat-round-line`、加载旋转 `refresh` + `animate-spin`、折叠箭头 `alt-arrow-down` / `alt-arrow-up`。

### 6.2 尺寸梯度

| 场景                       | 类            |
| -------------------------- | ------------- |
| 行内 inline 状态点         | `h-2.5 w-2.5` |
| chip 内、tag 内            | `h-3 w-3`     |
| 按钮内、菜单项前缀         | `h-3.5 w-3.5` |
| 卡片左侧主图标块（含底色） | `h-4 w-4`     |
| Hero / 空状态居中大图标    | `h-8 w-8` ~ `h-10 w-10` |

图标颜色一律走 token：`text-primary` / `text-muted-foreground/60` / `text-destructive`，禁止 `text-emerald-*` 之外的原色（参 §1.3）。

---

## 7. 桌面端特有

### 7.1 drag-region

- 顶部高度 ≥ 32px 的窗口拖拽区域使用 `.drag-region`（已定义于 `styles.css`）。
- **禁止**在 `drag-region` 内放交互元素，如必须放（设置图标、关闭按钮）请套 `.no-drag`。
- 不要在 `drag-region` 上再写 `cursor-*` 或 `onClick`。

### 7.2 标题栏

新页面顶部留 `<div className="drag-region h-12 shrink-0" />` 作为可拖拽空白，再写页面 header；不要把 header 自身设为 drag-region。

### 7.3 滚动条

`styles.css` 已实现 macOS 风格 overlay scrollbar。**禁止**在组件里手写 `::-webkit-scrollbar` / `scrollbar-width`，否则会撕裂全局风格。

### 7.4 选中态

`::selection` 已用 `color-mix(var(--primary) 15%)`。不要为组件单独覆盖。

### 7.5 暗色为默认

`:root` 即暗色。亮色靠 `[data-theme="light"]`。**只有装饰性效果**（如外发光、网格纹理）才需要 `dark:` / `light:` 变体；token 颜色会自适应，**不要**为每个 token 类再写一份 `dark:`。

---

## 8. 组件使用纪律

来自 `AGENTS.md §1`，本节不再展开，仅划红线：

- 操作按钮**必须**用 `@shared/components/ui/button` 的 `<Button>` + variant，**优先复用通用组件，禁止重复造按钮**。
  - **禁止**手写 `<button>` / `<motion.button>` 充当按钮：不允许自拼 `rounded-full bg-gradient-to-* px-4 py-2 text-primary-foreground` 这类样式。
  - **禁止**给按钮加发光/自定义阴影，如 `shadow-[0_8px_24px_-10px_var(--primary)]`、`shadow-[0_10px_30px_-12px_var(--primary)]`（"肮脏的发光按钮"被明确否决）。主操作直接用 `variant="primary"`，不叠任何 `shadow-*`。
  - 主操作 → `variant="primary"`；次要 → `variant="outline"` / `secondary` / `ghost`；危险 → `variant="destructive"`。空状态 CTA 同样走 `<Button>`，不要单独造一个"更花"的版本。
  - 需要微调位置/间距用 `className` 传入（如 `mt-2`），**不要**重写整套视觉。
- Popover / Dialog / Switch / Select 等先翻 `shared/components/ui/`，不要重写。
- 自定义 toggle / segmented control 时参考现有 `SegmentedControl`、`ToggleSwitch`，沿用相同 token 与 transition。

---

## 9. Lint checklist（agent 提交前自查）

- [ ] 没有 hex / `rgb(` / 默认 Tailwind 调色盘（slate/zinc/sky/violet/pink/orange/red/blue/green，除 §1.3 白名单的 emerald/amber）
- [ ] 没有 `shadow-[...]` 自定义任意值；卡片 hover 无 shadow；按钮无发光阴影
- [ ] 按钮一律用 `<Button>` + variant，没有手写 `<button>` / `<motion.button>` 自拼按钮样式
- [ ] 所有线条 1px：没有 `border-2/4`、`ring-2`、`outline-2`、`border-[Npx]`
- [ ] 没有 `rounded-3xl` / `rounded-[Npx]`
- [ ] 没有 `transition-all`
- [ ] hover `whileHover` 不超过 §5.1 表格
- [ ] 顶栏拖拽区域单独 `<div className="drag-region h-12 shrink-0" />`
- [ ] 没有手写 scrollbar 样式

---

## 10. 已知存量违规（不要复制）

以下文件混入了违规色或视觉，agent **不要**以它们为范例，遇到顺手清理：

- 暂无。`SkillsPage.tsx` 的 `violet-*` 自定义标签已迁移为 `bg-primary/10 text-primary`。
