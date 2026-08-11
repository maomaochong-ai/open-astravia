# 第 304 轮：当前架构质量门禁

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

重写已进入维护阶段，门禁目标从“统计迁移进度”切换为“防止当前架构重新失序”。本轮用一个轻量 AST 依赖守卫替代六个迁移期专用守卫，检查现在应长期成立的依赖方向、公开面和历史格式隔离。

## 实施内容

- 新增 `check-coding-agent-architecture.mjs`，只提取 import/export/dynamic import 边，不构建解析后的全量模块图，也不启动 TypeChecker。
- 以声明式清单固定包公开子路径与 Composition 公开符号。
- 约束 Contract、产品能力域、Adapter、Composition、Host 与 Public API 的依赖方向。
- 保留旧格式读取能力，并约束历史格式转换与文件写入的唯一所有者。
- 删除迁移进度、迁移残留、Legacy 执行退休、Composition 行数、Runtime Port 名称表和实施日志格式六组旧门禁及其专用测试。
- 将持久化和 Subagent 的类型合同移入 `composition/contracts`，消除门禁发现的合同到实现反向依赖；旧实现模块继续 re-export 类型，保持类型入口兼容。
- 修正 Desktop 测试的 `@vetta/coding-agent/config.js` 非公开子路径导入。

## 旧实现依赖变化

- `src/core`、`src/compat`：继续由当前架构门禁禁止恢复。
- Runtime 包对 Coding Agent 的反向依赖：继续由独立 Runtime 边界门禁保持为零。
- 历史会话格式到 Agent 执行的依赖：保持为零。
- 删除的是迁移期统计与名称墓碑，不恢复任何旧实现、旧执行入口或兼容分支。

## 行为兼容性验证

- 新架构门禁在真实仓库扫描 403 个 Coding Agent 源文件、2332 条模块边、20 个包公开子路径和 18 个 Composition 公开符号，结果通过。
- 架构门禁 10 项正反例测试通过，覆盖依赖方向、深层导入、历史格式写入与转换所有权、公开面及注释误判。
- `test:quality` 共 7 个文件、89 项通过。
- Coding Agent 包完整测试共 138 个文件、938 项通过；另有 1 个测试文件、17 项按既有条件跳过。
- 根 `bun run check` 全部通过，包括 Lint、Root/CLI/Desktop/Admin/Docs 类型检查及全部质量守卫。
- 本轮只移动类型合同与修改测试导入，不改变运行时控制流、持久化实现或 Subagent 行为。

## 尚未完成的替换

通用 `check-package-boundaries.mjs` 仍承担全仓跨包依赖、workspace 声明和 Composition Root 职责约束，本轮不将其并入 Coding Agent 专用守卫，以免扩大改动范围。后续只有在其规则本身出现维护问题时再按职责拆分，不需要构建全量 AST 模块图。
