# 引导模型用好你的扩展：重心偏移与优质扩展设计

> 适用对象：往仓库里新增 tools / MCP / skills / 系统插件的内部开发者，以及第三方插件开发者。
> 背景决策：[ADR-0071](../adr/0071-agent-mode-is-a-task-interpretation-prior.md)（工作模式是任务解释的先验）。

## 先建立正确的心智模型

模型处理一次请求有三个可施力的层：

```text
① 解释层   「这句话是什么任务？」——工作模式先验、工作区事实、路线声明在这里博弈
② 选择层   任务定了之后选哪个工具/skill——由 name + description 的语义匹配决定
③ 执行层   副作用发生前可不可以拦——execution mode 沙盒、插件权限、工具自身的业务校验
```

三个反直觉但已被验证的事实，决定了你该把力气花在哪：

1. **选择层没有"注册偏好"这回事。** 模型按 description 语义匹配选工具，不按清单位置；`agent_mode`
   字段已整体废弃（解析容忍、语义为零），声明它不会让你的工具在任何模式下更靠前或更靠后。
2. **模式不隐藏也不降权任何能力。** 你的扩展在 Work / Coding（以及未来的任何模式）下完整可用、
   顺序一致。想让某个模式"更常用你"，唯一的路径是让解释层把任务解释成你能接的形状。
3. **description 的每个 token 每轮都计费。** 工具 description 常驻 system prompt 前缀；写进去的
   规则模型每轮都读、你每轮都付费。规则正文属于 skill（按需加载），description 只放"什么时候
   用我 / 什么时候别用我"。

## 四个工具引导面

前三个作用在工具选择前的语义匹配上；返回值在工具执行后引导后续决策。

### 1. name：动词化、具体、无歧义

模型对工具名做的第一件事是语义联想。`render_chart` 好于 `chart`；`vetd_create` 带产品前缀避免
与通用词碰撞；`content_creation_edit` 一眼可知归属与动作。坏名字（`process`、`handle_data`）
迫使模型完全依赖 description，等于自废一半匹配信号。

### 2. description 正向触发段：用用户的语言描述任务

模型是在拿**用户的原话**匹配你的 description。所以触发条件要写成用户会说的任务措辞，
而不是实现视角的功能罗列：

```text
✅ Use when the user asks for a UI design, mockup, screen, deck, or poster,
   or attaches a design frame from the canvas.
❌ Provides vetd document scaffolding and frame management capabilities.
```

参数上同理：`vetd_create` 要求调用前先判断 `product` 品类，并把判断依据写进参数
description——「Take it from the user's request in whatever language they wrote it」。
这把一次容易做错的隐式判断变成了 schema 强制的显式判断。

### 3. description 反向触发段：唯一能让模型「少用你」的地方

这是被最多人忽视、却是重心偏移最关键的一半。想收窄使用场景，**不要**指望模式、排序或任何
声明式字段——把「什么时候不该用我 + 该用什么替代」直接写进 description。仓库里的范本：

```text
Do NOT use when the user is writing or modifying code in an existing codebase —
implement the page directly in that repo's own framework instead.
Only for standalone visual exploration decoupled from any codebase,
when the user asked for a design/mockup rather than working code.
```

（`vetd_create`，packages/plugins/presets/vetta-ui-design/src/tools.ts）

```text
Do NOT use to read or move media that belongs to the user's codebase — assets a
repository ships (public/, assets/, src/) stay where they are and are handled
with the ordinary file tools instead.
```

（`content_creation_assets`）

写反向触发段的三条纪律：

- **给替代路径，不只给禁令。** "别用我"之后必须跟"改用什么"，否则模型在无路可走时还是会用你。
- **针对真实误调场景写**，不是防御性堆砌。问自己：模型最可能在哪句用户指令上错选我？
  （`vetd_create` 的答案是"写个页面"——注释里就是这么记录的。）
- **与 mode md 的路线声明对齐措辞。** 宿主的 coding.md 用 "design-exploration tools /
  standalone design documents / canvas mockups" 这类**类别措辞**描述次要路线（宿主永不点名
  具体插件）；你的反向触发段把自己归入类别（"standalone visual exploration"），两边就接上了。
  这是插件与模式之间唯一的、也是刻意设计的接口：**自然语言归类，而不是字段注册**。

工具描述应与真实误调风险匹配：会创建工程、产生费用或对外发送内容的工具，要写清适用场景与替代路径。
只读工具没有明确误调场景时，不必堆砌防御性说明。这些描述帮助模型选择工具，不构成权限保证。

### 4. 工具返回值：被低估的最强引导面

description 只在选择时读一次，**返回值在选择之后每次都被完整阅读**——它是你在会话中途
持续引导模型的唯一通道。范本是 `vetd_status`：

- 返回里带 `sharedShell`（已有的公共外壳与组件清单）+ 一句 note："This design already has
  shared UI — reuse it instead of writing a second copy."。这解决了"模型一屏一屏写、写到第三屏
  早忘了第一屏抽过公共导航"的真实问题——**在返回值里把该复用的东西端到眼前，比在 skill 里
  多写一段规则管用**，因为返回值是每次都会读的。
- note 按「此刻最该做的一件事」给，不叠加——三条并列的建议等于没有重点。
- 出错时返回可执行的下一步（"Fix these first, with a targeted edit at the reported line"），
  而不是裸错误。

设计返回值时问自己：模型拿到这个返回后，下一步最容易做错什么？把纠偏信息放在那里。

## 执行边界

工具注册不再提供副作用等级，也不再触发会话首次调用确认。宿主不会替插件依据工具名分类或请求整段会话授权。
沙盒、插件权限、输入校验和工具已有的业务确认继续独立生效，例如内容生成计划仍须由用户在全局弹窗确认。
工具描述应说明实际会发生的文件写入、费用和外部动作，不能承诺宿主会自动拦截误调用。

## Skill 的引导设计

Skill 走渐进披露：清单里只有 name + description（每轮都在 prompt 里），正文按 `invoke_skill`
加载（只在被选中时付费）。所以：

- **description 是检索入口**，写法同工具的正向触发段——用户任务措辞 + 触发场景枚举
  （参考 vetta-ui-design 的 SKILL.md：把 "UI design, mockup, screen, deck, or poster" 全列出来）。
- **规则、流程、约束全部放正文。** 任何"你想让模型每次用你的工具前都知道"的长内容，都属于
  skill 正文而不是工具 description；用工具 description 的一句话把模型引到 skill
  （"invoke the vetta-ui-design skill for the rules before writing any of them"）。
- frontmatter 的 `agent_mode` 已废弃，写了会被忽略。

## 系统插件 / 宿主侧作者的额外杠杆

以下两个面属于宿主，第三方插件碰不到；内部开发者新增一条"路线级"能力（新的画布、新的重交付
形态）时应当考虑：

1. **mode md 的路线段**（`apps/desktop/src/main/agent-modes/modes/*.md`）：如果你的能力构成一条
   与"仓库内写代码 / 文档交付"并列的新路线，需要在相关模式的路线段用**类别措辞**声明它的
   默认位次与准入条件（参考 coding.md 的 "Default route for UI work" 段）。纪律：永不出现具体
   工具名或插件名——宿主描述任务类别，插件用 description 自归类。
2. **工作区事实探测**（`packages/coding-agent/src/model-context/workspace-facts.ts`）：事实比规则
   强。如果"cwd 里存在某标记 ⇒ 用户在做某类工作"对你的能力成立（如 `.vetd` 之于设计），
   把探测加进 facts 比在提示词里写十条规则都有效。注意它在会话创建时探测一次并固化。

## 第三方插件作者的边界

- 你**不能**改 mode md、workspace facts——你的全部引导面是：name、
  description（正反触发段）、参数 schema、返回值、skill。这个约束是
  刻意的：它保证任何插件都不能为自己抢占解释层。
- `ctx.getAgentMode()` 读到的是**新会话默认模式**，不是当前会话固化的模式——只能用于
  展示层软性定制（不同文案、不同默认视图），**禁止**在 tool / hook handler 里用它做行为
  分支（handler 可能跑在一个模式与默认值不同的会话里）。未知模式 id 一律按通用处理。
- Hook 按 `scope_use` + 事件/工具 matcher 触发，与模式无关——你的 hook 在所有模式下都会跑，
  按此设计幂等性。

## 反模式清单

| 反模式 | 为什么无效/有害 | 正解 |
| --- | --- | --- |
| 写 `agent_mode` 期待模式偏好 | 字段语义为零，纯装饰 | 反向触发段自归类 |
| 把使用规则塞进 description | 每轮计费、稀释触发信号 | 规则进 skill 正文，description 引流 |
| 用 `toolPolicy.deny` 表达"不推荐" | deny 是硬闸，模型连看都看不到 | 反向触发段 + 替代路径 |
| 依赖清单位置/注册顺序 | 位置对语义匹配无影响 | 无——放弃这个念头 |
| handler 里读 `getAgentMode()` 分支行为 | 读的是默认值不是会话值，必然出错 | 行为分支由输入参数或工作区状态驱动 |
| 返回裸数据/裸错误 | 浪费每轮必读的引导面 | 返回值带"下一步该做什么" |

## 发布前自检清单

- [ ] 工具名是动词化的具体名，带产品前缀避免碰撞
- [ ] description 有正向触发段（用户任务措辞）
- [ ] 有真实误调场景的，写了反向触发段 + 替代路径
- [ ] 长规则在 skill 正文，description 不超过一段
- [ ] 返回值在引导下一步，错误返回可执行
- [ ] 描述写明实际副作用，已有业务确认与权限校验仍然有效
- [ ] 没有写 `agent_mode`，没有在 handler 里读 `getAgentMode()`
- [ ] （宿主侧）构成新路线的能力更新了 mode md 类别措辞 / facts 探测，并保持零插件点名

## Vetta 扩展设计的八荣八耻

- 以描述任务为荣，以罗列功能为耻。
- 以指明何时别用为荣，以逢场必荐自己为耻。
- 以返回值引路为荣，以裸数据甩锅为耻。
- 以规则归入 skill 为荣，以 description 灌水为耻。
- 以说明实际影响为荣，以隐瞒费用和外部动作为耻。
- 以类别措辞自归类为荣，以字段注册求偏爱为耻。
- 以一句 note 点睛为荣，以三条建议并列为耻。
- 以放手让模型判断为荣，以硬闸藏匿能力为耻。
