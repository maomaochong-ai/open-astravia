# 第 138 轮：Greenfield Extension Command Host 边界与 RPC 命令发现

## 目标

把旧 Extension slash command 从 `RuntimeManager` 中抽成可独立验证的 Greenfield 宿主边界，同时恢复 Greenfield IM RPC 对 Prompt/Skill 的 `get_commands` 发现能力。任何尚未无损迁移的会话动作继续触发 Legacy 回退，不以 no-op 或抛错占位伪装能力完成。

## 分析结论

旧命令执行不只是“查表并调用 handler”，还包含以下可观察合同：

- 只按第一个普通空格拆分命令名与参数，后续空格原样保留。
- 未注册命令返回未处理，由后续 Skill/Prompt 展开继续消费。
- handler 失败通过 Runner 上报 `command:<name>` / `command` 错误，输入仍视为已处理。
- Extension command 可以走普通 prompt，但不能进入 steer/follow-up 队列。
- `ExtensionCommandContext` 必须同时提供 `waitForIdle`、`newSession`、`fork`、`navigateTree`、`switchSession`、`reload`。

其中 `newSession.setup` 暴露了 Legacy 具体类 `SessionManager`。Greenfield Conversation Document 没有同类型对象；静态兼容性评估也无法知道某个 command handler 是否会调用 `setup`。因此当前阶段不能安全地把生产宿主的 `commands` capability 改为 `true`。

这次没有引入 TypeBox 或 Zod：命令宿主接收的是仓库内部已类型化对象，不是外部不可信数据；RPC JSONL 的运行时校验已经在既有 Frame Validator 边界完成。重复做 schema 校验不会增加真实安全性。

## 实施内容

### 1. 独立 Greenfield Extension Command Host

新增 `CodingAgentGreenfieldExtensionCommandHost`：

- 构造时要求完整 `ExtensionCommandContextActions`，不允许缺少动作的半成品宿主。
- 复用现有 `ExtensionRunner` 的 first-wins command 查询和 Command Context。
- 保留 Legacy 参数解析、未知命令、错误上报与队列拒绝文案。
- 独立输出 Extension command catalog，包含来源文件路径。
- 通过 `@vetta/coding-agent/runtime-host/greenfield` 公开，供具体宿主完成会话迁移后显式注入。

### 2. Greenfield IM RPC 命令发现

`GREENFIELD_IM_RPC_PROFILE` 新增 `get_commands`，`GreenfieldImRpcSessionAdapter` 现在：

- 从动态 `ResourceLoader` 读取 Prompt 和 Skill，而不是启动时复制一份静态数组。
- 保留名称、描述、来源、位置和文件路径字段。
- 支持可选注入完整 Extension Command Host；注入后普通 prompt 先执行 command，steer/follow-up 拒绝排队。
- 当前生产组合只传 ResourceLoader，不传 Extension Command Host。

### 3. 回退边界保持不变

Greenfield IM 的 Extension capability descriptor 仍未声明 `commands: true`。因此：

- 无 Extension command 时，Greenfield RPC 可以真实发现 Prompt/Skill。
- Command-only Extension 仍返回 `legacy-extension` fallback。
- 不会因为新增了执行类就错误宣称完整业务等价。

## 测试

定向测试结果：

- `packages/coding-agent/test/runtime-core/greenfield-extension-command-host.test.ts`：3 个测试通过。
  - 六个动作完整委托。
  - 多空格参数保持。
  - 未知命令、队列拒绝和 handler 错误上报。
- `packages/cli-app/test/greenfield-im-rpc-adapter.test.ts`：9 个测试通过。
  - Prompt/Skill 发现。
  - 显式 Command Host 的 prompt 拦截。
  - steer/follow-up 拒绝。
- `packages/cli-app/test/greenfield-im-runtime-host.test.ts`：10 个测试通过。
  - 真实 Greenfield 宿主暴露 `get_commands`。
  - Command-only Extension 仍稳定回退 Legacy。

## 明确未修改

- 没有改变 Extension command 的公开 API。
- 没有把 Greenfield Conversation Document 伪装成 `SessionManager`。
- 没有实现不等价的 branch summary、session switch 或 reload 占位逻辑。
- 没有关闭 Command capability 的 Legacy fallback。

## 下一步

下一阶段应一次完成 Session Transition Host，而不是继续在 RPC Adapter 内堆条件分支：

1. 定义可替换活动 Session 的宿主级事务，统一处理 new/resume/fork、订阅迁移、ownership 和失败回滚。
2. 为旧 `newSession.setup(SessionManager)` 建立明确的兼容适配，或先通过版本化公共合同迁移成存储中立的初始化端口；未经决定不得删除该能力。
3. 补齐 `navigateTree` 的 summary/label、Extension before/after session 事件和 reload 资源重绑定差分。
4. 六个动作通过 Legacy/Greenfield 差分后，生产组合注入 Command Host，并将 capability descriptor 的 `commands` 改为 `true`。
