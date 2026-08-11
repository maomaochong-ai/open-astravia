# 第 97 轮：Desktop 独立产物与真实进程重启闭环

## 1. 目标

第 96 轮证明了独立安装的 CLI 产物可以跨进程恢复 Greenfield 会话，但尚未覆盖 Desktop
真实宿主。此前 Desktop Runtime Canary 仍存在三个空缺：

- Debug 请求由仓库源码 CLI 发起，未使用 Desktop 实际安装的 CLI；
- 只验证一次 Desktop 退出，没有由新的 Desktop OS 进程恢复同一会话；
- Canary 没有证明 Desktop Composition Root 注入的 Skill 与 MCP 在重启后仍可用。

本轮把三项合并为一个真实进程门禁。目标仍是验证架构边界和行为兼容性，不改变 Agent
工具、Prompt、Skill、MCP 或会话的既有业务语义。

## 2. 实施内容

### 2.1 Canary 使用 Desktop 安装的独立 CLI

Runtime Canary Provider 为本轮隔离环境声明正式 CLI 安装路径。Desktop 完成 CLI 安装后，
Canary Runner 等待该文件出现，并拒绝仓库目录内的路径。后续所有 `debug run` 请求均直接启动
安装目录中的可执行文件，工作目录切换到 Canary workspace。

同时新增独立产物构建质量守卫，校验 Desktop、开发 shim 和安装产物测试都复用唯一的
`scripts/compile-standalone.mjs`，避免再次出现多个编译入口参数漂移。

### 2.2 UI 验证宿主管理两代 Desktop 进程

`verify:ui:start -- --runtime-canary greenfield` 的宿主现在负责 Desktop 进程代际，而不是在第一代
退出时同步结束：

1. 启动第一代 Desktop，创建并继续交互会话，同时启动 Scheduler 与 Batch 消费者；
2. Runner 写入重启请求并要求第一代 Desktop 优雅退出；
3. 宿主检查第一代退出码、Debug endpoint 删除和所有会话锁释放；
4. 宿主启动第二代 Desktop，并发布新的 PID、端口和代际状态；
5. Runner 使用同一独立 CLI、同一 workspace 和同一 session path 继续会话；
6. 第二代完成 MCP Tool Loop 后再次优雅退出；
7. 宿主停止 Provider，并汇总两代 PID、退出码和清理状态。

Canary 使用专用 Electron user data 目录。仅在该隔离模式下增加无 GPU、无 sandbox 启动参数，
不影响普通 Desktop 开发和生产启动参数。

### 2.3 Desktop Composition Root 注入 MCP Runtime Source

`DesktopGreenfieldRuntimeBackendPool` 新增按 workspace scope 创建
`DesktopGreenfieldManagedMcpRuntimeSource` 的宿主扩展点。每个 scope：

- 只创建一个 MCP source；
- 将 source 注入对应 Greenfield Composition；
- Composition 创建失败时立即释放 source；
- Backend Pool 释放时同时释放 Composition 和 MCP source，并聚合清理错误。

Desktop 当前使用既有 `McpManager` 作为宿主反腐适配器，读取既有 `mcp.json` 并提供
`McpRuntimeToolSource` 合同。Greenfield Runtime Core 不依赖 `McpManager`，也不负责解析 Desktop
配置。`@vetta/runtime-mcp` 作为 Desktop 的直接 workspace 依赖显式声明，不再依靠传递依赖。

### 2.4 重启后重新装配动态能力

Canary 宿主目录新增隔离的 `SKILL.md` 与本地 stdio MCP server。第二代 Desktop 从相同宿主目录
重新创建 Composition，并完成：

- Provider 请求中出现 Skill marker；
- 模型发起 `mcp_runtime_canary_echo` 调用；
- MCP 返回结果后模型完成第二次响应；
- 重启 Prompt 与 MCP Prompt 写入原会话历史。

这验证的是“每个进程重新装配当前宿主能力”。Tool、Prompt、Skill 与 MCP 集合没有作为会话快照
持久化；跨进程保存的仍然只是会话事实。

## 3. 真实 Canary 暴露并修复的问题

### 3.1 中断后的待回答问题是可恢复会话事实

第一代 Desktop 退出时会中止正在等待用户输入的 `ask_user_question`，但持久化会话保留了
`input_required`。第二代直接发送新 Prompt 时，Runtime 正确地先返回这个待处理交互。

Canary Runner 现在接受该恢复结果，校验问题身份后通过 `conversation.answer` 取消旧交互，再继续
重启 Prompt。这里没有丢弃或隐藏待回答事件，也没有修改 Runtime 的恢复语义。

### 3.2 Provider fixture 不能按完整历史路由当前响应

旧 fixture 用整个模型输入历史做字符串匹配。会话历史包含旧的提问 Prompt 后，所有后续请求都会
再次命中提问分支，导致重启响应错误。

修复后 Provider 只根据最新输入项选择当前响应，并优先识别最新 MCP Tool Result。新增测试覆盖：

- 历史包含旧提问、最新输入是重启 Prompt；
- 最新输入是 MCP `function_call_output`。

该修复只约束确定性测试 Provider，不改变正式 Provider 或模型调用行为。

## 4. 明确未修改

- 未修改任何内置工具的名称、参数、描述、权限或执行结果；
- 未修改 Tool profile、动态注册和移除合同；
- 未修改 Skill 发现、Prompt 编译或 MCP 工具命名规则；
- 未修改 conversation JSONL、session id、ownership lock 或事件合同；
- 未把 Desktop 配置解析职责放入 Runtime Core；
- 未切换 Desktop Greenfield 默认启用范围；
- 未读取或修改用户真实模型、认证、Skill、MCP 和会话数据。

## 5. 验证结果

Desktop 定向类型检查：

```text
tsc --noEmit -p packages/desktop-app/tsconfig.json
通过
```

Runtime Canary Provider、Runner、消费者定义与 Backend Pool 定向测试：

```text
4 files passed
15 tests passed
```

独立安装产物门禁：

```text
1 file passed
1 test passed
```

真实 Desktop 双进程 Canary：

```text
第一代 Desktop PID: 28496
第二代 Desktop PID: 31628
restartCount: 1
desktopExitCodes: [0, 0]
同一会话恢复、Skill、MCP、Scheduler、Batch、锁与 endpoint 清理全部通过
```

快速质量门：

```text
bun run check:quick
通过
```

完整质量门：

```text
bun run check
Biome、monorepo tsgo、cli-app tsgo、desktop-app tsc、admin tsc 与 guards 全部通过
```

## 6. 结论与下一步

当前门禁覆盖的发布链路已经扩展为：

```text
Desktop 安装独立 CLI
  -> 第一代 Desktop 创建会话与并发消费者
  -> 优雅退出并释放宿主资源
  -> 第二代 Desktop 重新装配 Skill/MCP
  -> 独立 CLI 恢复同一会话
  -> MCP Tool Loop 与最终清理
```

下一阶段应收缩临时宿主适配边界：把“从 Desktop 配置创建、刷新和释放 MCP source”的职责整理为
`runtime-mcp` 面向宿主的独立 adapter，由 Desktop Composition Root 直接组合；既有 `McpManager`
继续服务 Legacy 路径。实施时先冻结配置热更新、动态移除和进程清理的差分测试，再迁移适配代码，
避免借架构调整改变 MCP 功能。
