# 141：Extension 宿主能力与事件闭环

## 目标

在不改变 Legacy Extension API 和 Greenfield IM RPC Profile 功能面的前提下，消除两类错误混合：

- 宿主实际需要、但 Greenfield 尚未接线的能力；
- 当前宿主没有承载面、因此不应触发 Legacy 回退的能力。

本轮补齐 `resources_discover`、压缩和 `model_select`，并把 Shortcut、Message Renderer 与
`user_bash` 明确建模为 Greenfield IM RPC 不适用能力。

## 分析结论

### 1. “不适用”不等于“已支持”

Legacy RPC 只读取 Extension Command，并通过 RPC UI Bridge 承载对话框、通知、状态和编辑器请求；
它没有键盘输入分发，也没有自定义消息渲染出口。因此 Shortcut 和 Message Renderer 即使触发
Legacy 回退，也不会被 Legacy RPC 消费。

兼容性结果现在分别保留：

- `requiredRuntimeCapabilities`：Extension 注册事实；
- `inapplicableRuntimeCapabilities` / `inapplicableEvents`：当前宿主没有承载面的事实；
- `unmetRuntimeCapabilities` / `unsupportedEvents`：当前宿主应当承载但尚未实现的缺口。

只有最后一类缺口触发 `requiresLegacyRuntime`。没有把不适用能力伪装成 `shortcuts: true` 或
`messageRenderers: true`。

### 2. 压缩适配器必须读取当前 Runner

压缩 Context Runtime 在 Session 创建时生成，而 Extension Runner 在 Session 绑定和 reload 时才确定。
如果压缩适配器捕获某个固定 Runner，reload 后会继续向已释放的 Extension 发事件。

因此压缩适配器改为每个 before/after 阶段读取活动 Runner。CLI Composition Root 注入稳定读取函数，
Session 切换和 reload 后自动观察当前绑定，没有让 Runtime Core 依赖 Extension 类型。

### 3. 模型事件属于 Extension Action Host

Greenfield 的 Extension `setModel()` 已经能调用 Runtime Model Controller，但之前没有发出
`model_select`。本轮在模型实际变化后，以旧语义发出一次：

- `previousModel` 为选择前模型；
- `model` 为 Runtime 最终选中的模型；
- `source` 为 `set`；
- 选择相同模型时不发事件。

### 4. 资源发现仍由 coding-agent 编排

`resources_discover` 返回 Skill、Prompt 和 Theme 路径，属于 coding-agent ResourceLoader 的产品语义，
不属于 Runtime Core。Greenfield Extension Event Host 复用 Legacy 的临时路径元数据规则，在
`session_start` 后和 reload 新 Runner 启动后扩展资源。

## 实施内容

### coding-agent

- Extension 兼容性评估增加不适用能力和事件诊断。
- Greenfield 支持事件集合增加：
  - `resources_discover`
  - `session_before_compact`
  - `session_compact`
  - `model_select`
- Extension Action Host 在模型实际变化后发出 `model_select`。
- Extension Event Host 执行资源发现，并保留 Extension 来源、临时作用域和相对路径基准。
- Compaction Extension Runtime 改为逐阶段读取活动 Runner。
- Legacy RPC 特征测试明确证明它不读取 Shortcut 和 Message Renderer。

### CLI Composition Root

- Greenfield IM RPC 将 Shortcut、Message Renderer 和 `user_bash` 声明为不适用，而不是已支持。
- 初始 Extension Session 在 `session_start` 后执行 startup 资源发现。
- reload 的新 Runner 在 `session_start` 后执行 reload 资源发现。
- Greenfield Context Runtime 接入动态 Compaction Extension Runtime。

## 功能兼容性

保留的旧行为包括：

- 未知或真正未实现的 Extension 事件仍然触发 Legacy 回退。
- Extension 压缩前事件仍能取消压缩或提供自定义结果，压缩后事件仍在提交后触发。
- reload 后的压缩事件、资源发现和模型事件使用新 Runner。
- `resources_discover` 的路径来源和临时作用域与 Legacy 一致。
- `model_select` 只在模型实际变化后发出。
- 交互式 Shortcut、Message Renderer 和用户 Bash 没有被移入 Runtime Core，也没有新增虚假 RPC 协议。

## Schema 决策

本轮没有新增外部输入或持久化格式。兼容性三态、Runner Source 和事件回调都是进程内 TypeScript
合同，因此不需要引入 TypeBox 或 Zod；既有 RPC 帧仍由原 TypeBox 边界校验。

## 测试

新增或扩展的测试覆盖：

- Extension 能力的 supported、unsupported、inapplicable 区分。
- Legacy RPC 不读取 Shortcut 和 Message Renderer。
- Compaction Runtime 在每个阶段读取当前 Runner，并允许 Runner 被移除。
- 模型实际变化后的 `model_select` 事件。
- 仅注册 RPC 不适用能力的 Extension 不再回退。
- startup 与 reload 的 `resources_discover` Prompt 贡献。
- 真实 Greenfield IM Session 的 Extension 模型切换。
- 真实 Greenfield Context Controller 的压缩取消事件。

验证命令：

```text
bunx vitest --run（coding-agent 定向 12 项）
bunx vitest --run test/greenfield-im-runtime-host.test.ts（cli-app 16 项）
bun run check:quick
bun run check:types
bun run check
git diff --check
```

还尝试运行了 coding-agent 与 cli-app 的完整包测试。与本轮直接相关的测试均通过；完整测试集仍存在
当前工作树和 Windows 环境中的既有失败，包括路径分隔符、旧命令文案、模型 fixture、并发超时和
历史 mock 缺失。本轮唯一直接相关的 Host Bootstrap 精确对象断言已随新增诊断字段修正并重新通过。

## 结果

Greenfield IM 的 Extension 选择现在按宿主真实能力判断。需要承载的资源、压缩和模型事件已经接通；
没有 RPC 承载面的 UI 注册不再造成无意义 Legacy 回退，且诊断仍能明确显示这些注册为何未执行。

## 下一步

下一阶段应进行 Greenfield IM Extension 切换门禁收口：枚举仍会导致 `legacy-extension` 的实际注册，
建立真实 Vetta CLI/RPC 会话差分清单，并只处理当前 Profile 可观察的剩余缺口。交互式 Shortcut 和
Message Renderer 应留给未来独立 Greenfield UI Host，不进入这一迁移链路。
