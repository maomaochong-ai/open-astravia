# 第 303 轮：公开协议与类型门禁稳定性

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

本轮修复两个稳定性缺口：恢复根级完整类型门禁；纠正第 302 轮把公开协议标识与旧执行架构一并中性化的过度收敛。架构重写允许移除旧执行路径，但不能静默改动已经公开的 RPC、历史会话迁移和 SDK Host 合同。

## 实施内容

- 将 `InputField.onBlur` 的合同改为 React 原生 `FocusEventHandler<HTMLInputElement>`，允许调用方读取 `relatedTarget`，不改变运行时行为。
- 恢复 RPC 对外 Profile ID：`greenfield` 与 `greenfield-im`。
- 恢复历史会话迁移成功结果的公开判别值 `greenfield`。
- 恢复公开 SDK Host 无模型错误码 `greenfield_sdk_no_model`。
- 保持 CLI Runtime Host 内部判别值 `rpc` / `print`，内部 SDK custom tool 与 storage 错误码继续使用 `coding_agent_sdk_*`；未恢复任何旧执行分支。
- 将四组冻结公开协议规则写入迁移残留审查脚本，按所属文件和精确出现次数验证。合法值只在公开合同边界豁免，缺失、新增或向其他生产文件扩散都会失败。

## 旧实现依赖变化

- 旧执行入口、旧实现引用、迁移文件和兼容导出：保持 `0`。
- Runtime 包对 Coding Agent 的反向依赖：保持 `0`。
- Desktop 对 Runtime 工作区源码的相对导入：保持 `0`。
- 未分类 Greenfield 生产文本：保持 `0`。
- 冻结公开协议偏差：`0`；四条规则共固定七个公开字面量出现位置，不构成旧 Runtime 选择或回退路径。

## 行为兼容性验证

- Desktop 独立 `tsc --noEmit` 通过，修复此前 `PresetProviderRowView.tsx` 的 `onBlur` 类型阻断。
- Coding Agent 公开 API 与 RPC 定向测试：2 个文件、19 项通过。
- CLI 历史会话迁移与真实 RPC 子进程恢复测试：2 个文件、10 项通过。
- 迁移残留审查测试：31 项通过，覆盖合法固定位置、缺失值、额外值和边界外扩散。
- `bun run check:quick` 通过；真实仓库扫描报告冻结公开协议偏差与未分类生产文本均为 `0`。
- 根 `bun run check` 全部通过，包括 Lint、Root/CLI/Desktop/Admin/Docs 类型检查及全部质量守卫。

## 尚未完成的替换

本轮两个问题均已关闭。公开协议中的 `greenfield` 字面量是必须保留的兼容合同，不代表双 Runtime、旧执行入口或迁移回退仍然存在；后续不得再以清理迁移命名为由修改这些公开值。Coding Agent 固定目标范围内没有因本轮新增的替换债务。
