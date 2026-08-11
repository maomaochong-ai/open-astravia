# Pi 设计复盘与替代方案

## 先回答核心问题

Pi 的生态价值证明了它的**作者合同和分发方式有市场验证**，不证明它的内部结构就是 Vetta 最好的实现方式。

本方案要兼容的是：

- Extension 作者在行为子集中使用的 import 与注册语义；
- Tool、共有事件、命令、会话动作、结构化交互和配置型 Provider 的可观察行为；
- Pi Package 中 Extension、Skill、Prompt 的发现与来源模型；
- reload、session replacement、动态注册等生命周期预期。

不应复制的是：

- 单个大 `types.ts`/runner 对所有能力的所有权；
- 直接修改多个 mutable Map 的注册模型；
- 把具体 TUI、SessionManager、ModelRegistry 类型当作跨宿主公共 ABI；
- 仅靠包名 alias 和版本号推断兼容；
- 让 Schema 库版本进入领域核心。

## Pi 做得好的地方

### 统一的 Extension 作者入口

Pi 用一个 Extension factory、统一 `pi.register*` 与 `pi.on` 覆盖 Tool、Command、Shortcut、Flag、Renderer、Provider 和事件。作者不需要先理解多个内部 runtime package，学习成本低。大量 examples 也形成了可搜索的事实文档。

Vetta 应吸收“一个作者入口、明确 capability”的体验，但内部仍可编译到多个 runtime port。

### Package 与资源生态

Extension、Skill、Prompt Template、Theme 能从 package metadata 被发现，并有 source 信息。Vetta 已经能识别 package `pi` resource entries，这为兼容生态提供了很好的起点，无需另造安装格式；兼容 profile 只消费 Extension、Skill 和 Prompt，Theme 明确排除。

### Loader 的现实兼容性

Pi 当前 loader 同时支持 `@earendil-works/*`、`@mariozechner/*`、TypeBox current/legacy specifier，并兼顾源码、构建后 Node 和 Bun binary virtual module。它解决了真实生态中的 rename 和打包问题。

值得借鉴的是显式 specifier 表、同一 runtime module identity 和 cache generation；不值得照搬的是把整个 Pi 包根作为隐式 ABI。

### Lifecycle 的持续补强

Pi 已经补充 active/stale 检查、event bus subscription ownership、factory cache invalidation、动态 Tool refresh、Provider 注销和 replacement context 回归测试。这些都是早期 fork 后的重要合同级演进。

Vetta 应把这些能力下沉为通用 generation/catalog 语义，而不是只在 Pi runner 中打补丁。

### Project trust

project-local Extension 是可执行代码，Pi 在加载前建立 trust gate 是正确方向。它不是 sandbox，但能避免进入陌生目录就自动执行项目代码。

Vetta 采用开放受信执行模型后，这条边界更加重要：开放模型意味着清楚地决定是否执行，而不是取消 trust。

## 为什么不兼容 Pi TUI

这不是阶段优先级，而是产品边界：

1. Pi `Component`、Theme、keybinding、terminal redraw 和 focus lifecycle 是具体终端实现，不是 Agent 行为协议；
2. Vetta 同时存在 Desktop、CLI、RPC 和 SDK，复制 Pi TUI 会制造只对一个宿主成立的第二套 UI runtime；
3. Desktop 展示扩展已有 Plugin SDK 和宿主能力体系，不应通过 Pi renderer 绕过其 i18n、权限和生命周期；
4. Tool renderer、message renderer 和 Theme 不影响模型 Tool 执行，剥离它们比建设 component bridge 更可维护；
5. runtime import `pi-tui` 的扩展无法只靠 shape adapter 正确执行，应稳定拒绝，而不是提供行为不完整的假实现。

可以兼容的 `notify/select/confirm/input` 只是字符串和结果组成的结构化交互，由 Vetta 自己渲染；这不构成 Pi TUI 兼容。

## 为什么先扩展 Vetta，再兼容 Pi

Vetta 已经有 model-call Tool snapshot、Session Tool overlay、结构化 prompt draft、transition transaction 和配置型 Provider。这些能力比 Pi adapter 更接近正确 owner，但尚未通过统一 contribution/generation 串起来。

如果先写 Pi adapter：

- 动态 Tool refresh 会绕过 Vetta native registration；
- `prepareArguments` 和 TypeBox 1 validator 会形成 Pi 专属执行路径；
- Pi lifecycle event 会从近似状态临时派生，native Extension 反而无法使用；
- Provider unregister 只能在 compat 层补偿，ModelRuntime 仍不知道 owner；
- 同一个 bug 需要 native tests 和 Pi tests 两套修复。

因此先增加 Vetta 原生 catalog、Tool validator/prompt、事实事件和 Provider owner，再让 Pi adapter 做投影。判断一个新增能力是否合理的简单标准是：**删除 `pi-compat` 后，它是否仍然能让 Vetta native Extension、SDK 或宿主受益。**不能通过这个标准的能力不应进入 Vetta 核心。

## Pi 设计的局限

### 缺少显式 ABI/Profile

Pi Extension 通常通过 import 成功和对象同形来获得兼容，没有一个机器可读的 ABI/profile 描述“哪些 export、事件结果和生命周期语义稳定”。包改名后同时 alias 新旧 namespace 很实用，但也可能把行为差异隐藏到运行期。

更好的方式是 capability profile：明确支持的 import/export、Schema baseline、host requirement 和 adaptation，并通过 corpus 发布。

### 类型与 Runner 责任过大

当前 Pi Extension 类型文件同时包含 API、Tool、Context、TUI、Provider、Event 等大量合同；runner 同时承担投影、分派、状态替换和错误处理。新增能力很容易触碰中心文件，审核和测试影响面变大。

更好的方式是 canonical discriminated contributions、声明式事件定义和分功能 adapter；中心 composition 只装配。

### Mutable registration 会产生半注册

Factory 执行时直接向多个 Map/队列注册，若中途抛错，就需要 loader/runner 正确补偿所有已产生副作用。动态注册进一步增加 owner 和刷新时序问题。

更好的方式是 generation-local draft + atomic catalog transaction。只有整体通过后才发布，失败天然丢弃。

### 泄漏具体宿主对象

Pi Extension context 能接触 SessionManager、ModelRegistry、TUI Component/Theme 等具体对象。这对单一 TUI 产品非常高效，却使 headless SDK、RPC、Desktop 等宿主难以 lossless 实现。

更好的方式是能力导向 facade：只读 session view、显式 actions 和四个结构化交互方法。不存在 host component bridge；宿主不支持交互时返回结构化 capability 结果。

### UI 与领域能力耦合

Tool execution 与自定义 TUI renderer 放在同一 ToolDefinition，容易让“工具能执行”和“Pi TUI 能渲染”被误判成同一个兼容级别。

更好的方式是 canonical Tool contribution 根本不包含 renderer。注册时剥离可选展示字段并报告 excluded；若 Extension 运行依赖 `pi-tui`，则拒绝加载，而不是在 Desktop 上执行 Pi component renderer。

### Schema 版本成为生态 ABI

Pi current 把 TypeBox 1 直接作为作者 Tool contract，并把 legacy `@sinclair/typebox` 也映射到它。这个选择改善了扩展运行一致性，但让 Schema 库升级成为隐含 ABI 变更。

更好的方式是 loader 兼容具体作者库，发布边界归一化为带 dialect metadata 的 plain JSON Schema，Runtime 只依赖 canonical contract。

### 信任不等于隔离

Project trust 只能回答“用户是否允许运行这段代码”，不能限制代码读取文件、访问网络或进程环境。采用开放模型时必须在产品文档中明确这一点，不能用“trusted”暗示权限隔离。

后续若要更细权限，应通过 host capability/permission contract 单独设计；本方案不把开放执行模型伪装成 sandbox。

## 可选方案比较

| 方案 | 生态覆盖 | 实施成本 | 长期维护 | 宿主独立 | 主要问题 |
| --- | --- | --- | --- | --- | --- |
| A. Pi 包名直接 alias 到 Vetta API | 低到中 | 低 | 差 | 差 | 同名异义、Schema/生命周期问题只在运行时暴露 |
| B. 直接依赖 Pi coding-agent/runner | 高 | 中 | 差 | 差 | 两套 Agent/Session/Tool 核心，破坏包边界，升级被上游绑定 |
| C. 独立进程/IPC 运行 Pi Extension | 中 | 很高 | 中 | 中 | 函数、TUI component、stream callback 难跨进程；作者行为难以 lossless |
| D. Native-first + ACL + canonical contribution IR | 行为子集可演进 | 中到高 | 好 | 好 | 前期需建立 native IR、事务目录和 corpus |
| E. 手工移植精选 Extension | 低 | 持续累积 | 中 | 好 | 不是生态兼容，用户仍无法直接使用第三方包 |

推荐 D，并严格要求 native fixture 先于 Pi fixture。C 可以在未来用于不需要 UI/函数对象的远程扩展协议或高隔离任务，但不是 Pi Extension ABI 的自然实现。A 可作为探索 spike，不能成为生产架构。B 看似最兼容，实际上会把 Vetta 重写后的运行时边界重新合并。

## 比 Pi 更进一步的设计

### 兼容性是数据，不是布尔值

每项能力输出 `lossless | adapted | host-dependent | excluded | unsupported`，并带原因码。`excluded` 表示产品明确不兼容，例如 Pi TUI，而不是等待实现的缺口。用户可以在执行前查看，CI 可以要求 strict，产品 host 可以选择允许适配项。

### Observer 与 Mutator 分离

事件定义显式标记 `observe`、`transform`、`short-circuit`。Observer 的错误策略不会意外中断变换链，Mutator 的返回值有专用 guard/folder，顺序可测试。

### 生命周期资源有 owner

Tool、Provider、subscription、command、timer/disposer 都归属于 extension + generation。reload、disable、session replacement 和 shutdown 使用同一套 owner teardown，不靠每个功能自行记账。Pi renderer 不进入目录。

### 作者 API 与领域 IR 解耦

Pi API、Vetta native API，未来甚至 declarative manifest，都可以编译为同一 contribution IR。新增宿主只消费 IR，不实现新的 Pi facade；新增作者 API 也不修改 Agent loop。

IR、catalog 和 lifecycle 首先由 Vetta native API 使用。Pi adapter 只是另一个 producer，不能成为 contribution 字段或运行时语义的唯一消费者。

### 原子注册和可回退更新

新 generation 完成 import、factory、Schema、compatibility 和 conflict 检查后才发布。更新失败保留旧 generation，不把“Extension 能否加载”变成 session 是否可继续工作的单点风险。

### 机器可读 profile 与生成文档

specifier allowlist/denylist、event mapping、host matrix 和 corpus 结果应生成兼容报告/文档。实现、测试和用户声明共享同一个 profile 数据源，避免 README 声称的兼容范围落后于代码。

### 稳定错误与来源链

每个错误携带 package source、resolved path、extensionId、generation、capability 和 operation。来源链统一后，冲突、加载失败、运行期错误和 package 更新可以用同一种诊断 UI 展示。

## 需要在 ADR 中确认的决策

实施前建议明确：

1. 初始 compatibility profile 的固定 Pi SHA 和升级策略；
2. native-first 阶段门槛，以及哪些原生能力批准进入公共 Extension contract；
3. `piCompatibility` 默认 `off`，哪些产品入口可以开启；
4. project trust 的来源粒度和撤销行为；
5. strict/host-aware 对结构化交互不可用的处理，以及 TUI excluded 的稳定规则；
6. catalog conflict priority 和 native/Pi contribution 的默认优先级；
7. TypeBox 1 的精确版本、Schema dialect/subset 和升级测试；
8. in-flight Tool 在 reload/disable 时的 grace/abort policy；
9. 配置型 Provider 的字段交集；TUI 不作为可选范围重新讨论。

建议默认值已经在本方案中给出；这些决策会影响公共行为、安全或数据诊断，因此不能在实现细节中静默决定。

## 事实来源

- Pi 固定版本的 [Extension types](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/src/core/extensions/types.ts)、[loader](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/src/core/extensions/loader.ts) 与 [runner](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/src/core/extensions/runner.ts)
- Vetta 当前 [Extension registration](../../../../packages/coding-agent/src/extensions/runtime/registration/extension-registration.ts)、[Extension runner](../../../../packages/coding-agent/src/extensions/runtime/extension-runner.ts) 与 [host compatibility contracts](../../../../packages/coding-agent/src/host/extensions/compatibility/contracts.ts)
- 完整路径和版本基线见[证据索引](../06-evidence-index.md)

最终判断是：**先把有独立产品价值的能力建设成 Vetta native contract，再拿 Pi 中可被这些合同表达的生态行为做映射；明确舍弃 TUI 和协议不等价能力。**
