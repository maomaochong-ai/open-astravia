# 第 302 轮：生产身份与 Runtime 包入口收口

<!-- coding-agent-rewrite-charter:v1:start -->
## 重写目标确认（固定）

- 删除旧 `coding-agent` 内部代码、目录、内部类和仅为旧架构服务的兼容层。
- `coding-agent` 最终只承担稳定 Session 合同、产品组合根和能力编排职责。
- 新生产代码对旧 `coding-agent` 实现的依赖必须收敛到零，不能通过改名、移动目录或包装 Adapter 延续旧架构。
- Agent 内核保持最小闭环；Tool、MCP、Skill、知识库、Memory、Compaction 和 Subagent 通过独立合同围绕内核组合。

## 必须保留（固定）

- 用户可观察的 Agent 功能，以及 CLI、SDK、RPC、IM 必须继续提供的产品能力和协议。
- 会话历史、认证、模型和设置等用户数据；必要时由显式、独立的新迁移器读取旧格式。
- 模型消息、工具消息、错误、取消、事件顺序、并发约束和资源释放语义。
- 仍然有效的行为测试场景和数据 fixture；旧实现可以临时作为测试 Oracle，但不能被新生产代码调用。
- `@vetta/ai` 与经过合同验证的 `@vetta/agent-core` 等独立下层能力，除非单独审计证明其合同不满足目标。

## 明确舍弃（固定）

- 旧 `src/core` 目录结构与实现，以及旧 `AgentSession`、`SessionManager`、Manager、Registry、工具工厂和资源加载器。
- 包根聚合暴露的内部对象、深层 `core` 导入和 `compat/*` 兼容入口。
- Runtime 包对 `coding-agent` 具体实现的反向依赖，以及只为旧内部调用方式存在的 Adapter。
- 对旧内部类、目录和属性有耦合的测试；保留其行为场景，不保留其结构性假设。
- 仅展示旧 API、没有独立产品需求的示例；示例不能反向决定新架构。
- 通过修改旧功能完成“迁移”，或在架构重写阶段顺带改变用户可见功能。
<!-- coding-agent-rewrite-charter:v1:end -->

## 本阶段与最终目标的关系

本轮关闭生产代码中最后的迁移期身份和 Desktop 对 Runtime 包源码目录的越界依赖。新的合同使用能力语义，不再用 `greenfield` 区分已经成为唯一生产实现的 Runtime；Desktop 只依赖 `@vetta/runtime-core` 公开入口，避免应用直接耦合工作区目录结构。

## 实施内容

- 将 RPC Session Profile ID 从迁移身份改为 `full` / `im`。
- 将 CLI Runtime Host Ready 判别值改为 `rpc` / `print`。
- 将历史会话迁移成功结果判别值改为 `session`，保留 `migrated` / `reused` 状态语义。
- 将 SDK 内部错误码前缀从 `greenfield_sdk_*` 改为产品语义 `coding_agent_sdk_*`。
- 将 Desktop main、preload、renderer 和 shared 中 35 个 `runtime-core/src/index.js` 相对导入改为 `@vetta/runtime-core`。
- 删除迁移残留守卫中的全部 Greenfield 协议字面量白名单；生产源码中的未分类 Greenfield 文本必须为零。
- 新增 Desktop Runtime 相对源码导入计数和反例测试，要求 `desktopRuntimeSourceImportFiles=0`。
- 将宿主验证脚本的迁移期日志标签改为中性 Agent suite 标签。

## 旧实现依赖变化

- 生产源码 Greenfield 协议白名单：15 条规则、17 个字面量降为 `0`。
- Coding Agent、CLI、Desktop 生产源码未分类 Greenfield 文本：`0`。
- Desktop 对 Runtime 工作区源码的相对导入：35 个降为 `0`。
- Runtime 包对 Coding Agent 的反向依赖：保持 `0`。
- 旧执行入口、旧实现引用、迁移文件和兼容导出：保持 `0`。

## 行为兼容性验证

- 迁移残留守卫：29 个测试通过；真实仓库扫描的生产 Greenfield 文本和 Desktop Runtime 源码导入均为 `0`。
- 定向合同测试：Coding Agent 22 项、CLI 27 项、Desktop 5 项全部通过。
- `bun run check:quick` 通过。
- Coding Agent 完整包测试：138 个测试文件通过、1 个跳过；938 项通过、17 项跳过。
- `bun run verify:agent-hosts` 通过独立 CLI 可执行产物、Coding Agent、CLI、Desktop 和 IM Gateway 全部验证；Desktop 为 128 个测试文件、535 项通过、1 项跳过。
- 根 `bun run check` 中 lint、全部质量守卫、根/CLI/Admin/Docs 类型检查通过；Desktop 类型检查被本轮未修改的 `packages/theme-ui/src/settings/PresetProviderRowView.tsx:181` 既有回调签名错误阻断。

## 尚未完成的替换

本轮计划内的生产迁移身份和 Desktop Runtime 包边界替换已完成，没有保留本轮兼容分支。测试 fixture、守卫反例和历史实施记录中的 Greenfield 文本仅作为历史验证材料，不进入生产合同。Coding Agent 目标范围内没有尚未完成的替换；仓库全量检查仍需由 Theme UI 所有者修复上述独立类型错误后恢复全绿。
