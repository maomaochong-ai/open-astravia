# 第 112 轮：真实宿主生命周期与动态能力边界收口

## 目标

本轮只收口源码组合下仍未被真实宿主差分覆盖的两类行为：

1. Legacy 与 Greenfield 的完整 Tool Loop 观察事件、持久化、RuntimeHost 重启恢复和关闭所有权。
2. Session 运行中新增、修改和删除 Skill 后，下一次 Model Call 立即生效且不重建 Session。

假设保持不变：这是架构重构，不改变 Tool、Skill、MCP、持久化或 selector 的产品语义；默认 Runtime
继续使用 Legacy。

## 实施内容

### 1. 建立真实 RuntimeHost 生命周期差分

Desktop 差分使用同一 OpenAI Responses fixture 分别运行 Legacy 与 Greenfield。每条路径都执行：

```text
create Session
  -> prompt
  -> read Tool Loop
  -> capture complete SessionEvent sequence
  -> dispose RuntimeHost / Backend Pool
  -> recreate host
  -> resume by persisted session path
  -> prompt again
```

测试比较事件 type、source 和稳定语义字段，并验证消息角色、Tool Result、恢复前历史、Session identity，
以及恢复后的 Provider 输入仍包含旧 Tool Result 和 assistant 消息。

### 2. 修复 Greenfield 观察事件投递

真实差分发现 EventSink 映射循环的局部变量与 Kernel Event 参数同名。JavaScript TDZ 异常被
`publishSafely` 隔离，造成 Repository 正常持久化但 SessionEvent 没有投递。

修复后：

- Kernel Event 参数不再被遮蔽。
- 监听器异常隔离语义保持不变。
- Tool、消息、usage、Turn lifecycle 和 MCP reload 事件重新进入既有 SessionEvent Stream。

### 3. 对齐 usage 与 MCP Prompt 边界

Greenfield `usage.update` 现在从实时 Session state 读取 context window，并按当前 assistant usage 计算
context percent；不再把 Context Runtime 在压缩检查点生成的阶段性估算值当作宿主事件值。

MCP 在 Prompt 边界发布既有 `mcp.reload.start/end` 观察事件。Prompt 已执行的刷新会被首个 Model Call
一次性复用，避免同一模型调用重复访问 Source；Tool Loop 中后续 Model Call 仍重新刷新，动态增删语义不变。

### 4. 修复启动后首次创建 Skill 根目录的刷新

原 ResourceLoader 只指纹化启动时实际存在的 Skill 路径。若 Session 启动时 `.vetta/skills` 不存在，
之后首次创建该目录不会触发刷新。

现在：

- 默认用户和项目 Skill 根即使不存在也参与拓扑指纹。
- 路径出现、内容变化或路径删除都会触发 Skill 级重载。
- 重载只更新 ResourceLoader 的 Skill 结果，不重建 Session、Runtime Snapshot 或无关 Feature。

Desktop 真实 Provider 测试在同一 Session 内验证不存在、添加 v1、修改为 v2、删除四个状态，并从下一次
模型请求的系统提示词观察结果。

## 明确未修改

- 未修改任何 Tool 名称、描述、JSON Schema、执行结果或错误语义。
- 未改变 Plugin、MCP、Skill、Knowledge 的激活规则。
- 未改变持久化格式和公开 Session API。
- 未改变 Legacy 默认 selector。
- 未刷新 `dist` 或运行禁用的 build；标准安装产物验证留给下一阶段。

## 类型校验决策

本轮新增的数据只在进程内通过 TypeScript 合同流转。Skill Markdown 继续使用既有 frontmatter 解析；
MCP 配置和持久化记录继续使用现有 TypeBox 边界。没有新的外部 JSON、配置或持久化反序列化入口，因此
不引入 Zod，也不重复增加 TypeBox Schema。

## 验证

- Desktop RuntimeHost 生命周期与 Model Call Frame 差分：15 项通过。
- Runtime Core Greenfield Session Backend：11 项通过。
- CLI Greenfield Composition：14 项通过。
- 根级 `bun run check:quick` 通过。
- 根级完整 `bun run check` 通过，包含 Biome、root tsgo、CLI、Desktop、Admin 和质量守卫。

额外运行完整 `resource-loader.test.ts` 时有 5 个既有断言失败，涉及 Prompt 优先级、Extension 覆盖和
`.pi/SYSTEM.md`；本轮 diff 只触及 Skill 指纹与 Skill 路径重载，且新增真实动态 Skill 差分已通过，因此
没有把这些无关旧测试失败作为修改 Prompt/Extension 行为的理由。

## 下一步

下一阶段按一个完整阶段执行标准安装产物差分：

1. 通过仓库允许的 workspace 前置产物流程刷新标准 `dist`。
2. 在安装产物中复验完整 Provider Frame、SessionEvent、持久化、宿主重启恢复和关闭。
3. 复验运行时 Skill/MCP/Tool 变化与在途 Turn 绑定，排除源码 path alias 掩盖的打包缺口。
4. 继续保持 Legacy 默认 selector，产物门禁通过后再单独讨论切换和旧实现删除。
