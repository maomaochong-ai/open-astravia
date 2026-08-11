# 140：Extension Command Context 与运行时热重载

## 目标

在不改变旧 Extension 功能语义的前提下，完成 Greenfield IM Runtime 对
`ExtensionCommandContextActions` 六项动作的生产接线：

- `waitForIdle`
- `newSession`
- `fork`
- `navigateTree`
- `switchSession`
- `reload`

同时解除 Command-only Extension 的 Legacy 回退，并确保 Session 切换与资源重载后，RPC
始终使用当前 Session 的 Runner、命令和工具定义。

## 分析结论

### 1. 树导航不是 Runtime Core 的业务

旧 `navigateTree()` 同时包含：公共祖先计算、离开分支摘要、Extension 前后事件、标签和活动
Leaf 更新。只有“把分支摘要写入 ConversationDocument”属于 Runtime Core 的持久化职责；摘要
算法和 Extension 编排仍属于 coding-agent。

因此本轮只给 `RuntimeSessionHistoryController` 增加 `appendBranchSummary()`，没有把
`generateBranchSummary()` 或 Extension 类型下沉到 Runtime Core。

### 2. reload 必须替换运行期能力，不能只重新读取文件

旧 reload 会重新加载 Settings、Provider 和 Resource。Extension 文件变化还会改变事件、命令和
工具定义。仅调用 `resourceLoader.reload()` 会让 Prompt/Skill 更新，但已有 Runner 和冻结的 Tool
注册表仍然陈旧，属于功能退化。

本轮把 reload 处理成 Session 级绑定事务：旧 Runner 发出 `session_shutdown`，资源加载完成后准备
新 Event/Command Host，动态刷新 Extension Tool 注册表，新 Runner 成功发出 `session_start` 后才
替换稳定门面并释放旧绑定。

### 3. 同 Session Runner 替换必须显式授权

既有 Event Bridge 和 Extension Tool Runtime 会拒绝同一 Session 的第二个 Runner，这个保护应当
保留。热重载通过显式 `replaceExisting` 选项进入替换路径；普通重复绑定仍然报错。准备失败时会
释放新绑定并恢复旧 Runner，而不是把桥留在无绑定状态。

### 4. 不需要 TypeBox 或 Zod

本轮新增输入均为进程内 TypeScript 合同，外部 RPC 帧仍由既有 TypeBox 边界校验。为内部函数再
增加一层运行时 Schema 不会增加可信边界，因此没有引入 Zod/TypeBox。

## 实施内容

### Runtime Core

- 新增 `branch_summary.append` ConversationDocument 命令。
- 校验摘要 ID 唯一性和父节点存在性。
- 写入 `branch_summary` 后把摘要设为活动 Leaf。
- `RuntimeSessionHistoryController`、Greenfield Session Backend 和 Legacy Adapter 同步实现
  `appendBranchSummary()`。

### coding-agent

- 新增 `CodingAgentGreenfieldBranchNavigationHost`：复用既有摘要收集/生成算法、API Key 解析、
  `session_before_tree`/`session_tree` 和标签语义。
- 新增 `CodingAgentGreenfieldResourceReloadHost`：保持 Settings → Provider → Resource → Extension
  后处理顺序。
- `CodingAgentGreenfieldActiveSessionHost` 新增串行化的 `waitForIdle()` 与
  `runActiveSessionMutation()`，树导航和 reload 不会与 Session 切换并发修改活动会话。
- Extension Event Bridge 与 Tool Runtime 增加显式 Runner 替换事务。
- Extension Tool Runtime 的注册定义改为可刷新；Session Runner 绑定保持稳定。
- Greenfield Runtime Composition 暴露窄的 `refreshExtensionTools()` 入口。
- Greenfield 支持事件补齐 Session switch/fork/tree 前后事件。

### CLI Composition Root

- 将 `GreenfieldImExtensionSessionHost` 从大型 Runtime Host 文件拆为独立 Session Binding
  Controller。
- Controller 同时管理当前 Event Host 与 Command Host，并向 RPC Adapter 提供稳定命令门面。
- 六项 `ExtensionCommandContextActions` 全部接入 Active Session、Branch Navigation 和 Resource
  Reload Host。
- Extension Event Host 工厂改为每次读取 `resourceLoader.getExtensions()`，不持有启动时旧快照。
- reload 后重新应用 CLI Extension Flag、重新注册 Extension Provider，并刷新工具定义。
- Greenfield Extension 兼容能力正式声明 `commands: true`。

## 功能兼容性

保留的旧行为包括：

- Extension 命令仍不能进入 steer/follow-up 队列。
- 命令处理器异常仍由 Extension 错误通道隔离，不污染 RPC Turn。
- 新建、切换、Fork 和树导航仍支持 Extension 取消。
- 分支摘要仍支持 Extension 覆盖、自定义指令、替换指令、文件详情和标签。
- reload 仍按 `session_shutdown` → 重载 → `session_start` 顺序观察。
- Extension 文件在运行中新增、删除或替换命令/事件/工具后，下一次发现和模型调用读取新定义。
- Shortcut 与 Message Renderer 仍未进入 Greenfield IM Profile，继续保持独立 Legacy 回退能力，未在
  本轮误宣称支持。

## 测试

新增或扩展的测试覆盖：

- ConversationDocument 分支摘要追加与非法父节点。
- Legacy/Greenfield History Controller 摘要写入兼容。
- Branch Navigation 的 Extension 摘要、默认摘要、标签和事件。
- Resource reload 顺序及失败短路。
- Extension Tool 定义动态刷新。
- Event Bridge 仅在显式事务中替换同 Session Runner。
- 真实 Greenfield IM Runtime 的 Extension 命令执行和发现。
- 运行中修改 Extension 文件后，命令与 Session 生命周期的原子热重载。
- 既有 Session 切换、RPC Adapter 和 Runtime Host Assembly 回归。

验证命令：

```text
bun run check:quick
bun run check:types
vitest --run（runtime-core 定向 29 项）
vitest --run（coding-agent 定向 22 项）
vitest --run（cli-app 定向 22 项）
bun run check
```

## 结果

Greenfield IM Runtime 现在拥有完整 Extension Command Context，不再因 Command-only Extension
回退 Legacy。命令、事件和工具的运行时变化通过显式 Session Binding 事务生效，Runtime Core
仍只承担稳定历史写合同，没有吸收 coding-agent 的摘要或 Extension 业务。

## 下一步

下一阶段应处理仍然独立回退的 Shortcut 与 Message Renderer：先定义宿主 UI 能力合同，再决定
IM/RPC 是否有等价承载面；不能为了清零回退而把交互式 UI 行为硬塞进 Runtime Core。
