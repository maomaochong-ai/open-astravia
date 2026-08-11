# 第 228 阶段：Runtime 原生无状态 Tool Host 边界

## 阶段目标

把仍由旧 Tool/Utils 实现控制的无状态宿主能力迁到独立合同：命令子进程、Office/WPS 文档转 PDF、OCR 并发限制、写入保护路径和 CLI `@file` 路径解析。`coding-agent` 只负责产品组合与平台适配，`runtime-tools` 提供中立原语；不改变工具名称、参数、输出、错误、取消、超时或用户文件处理行为。

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

这些能力不是 Agent 内核，也不应由旧 Tool 类或通用 Utils 隐式拥有。命令进程和路径政策属于宿主 Adapter，文档转换属于产品 Operations，OCR 并发属于共享运行时资源，路径解析属于中立 Runtime 原语。此次迁移重建了这些边界，生产代码不再调用对应旧实现，也没有把旧类改名后继续包装。

## 实施内容

- 新增 `CommandProcessPort` 的 Coding Agent 平台 Adapter，保留 stdout/stderr、非零退出、spawn 错误、取消、超时、输出上限和进程树终止语义。
- 新增独立文档转 PDF Operations，保持 Windows Office/WPS 注册表与 PATH 探测顺序、macOS Office 探测和 60 秒转换限制。
- 在 `runtime-tools` 增加 FIFO 异步执行 Gate；Coding Agent 通过 Session 共享 Gate 保留 OCR 并发环境变量与默认单并发行为。
- Skill、Scene、Knowledge/Wiki 写保护改由宿主路径政策 Adapter 实现，保留全部既有保护根和路径边界判断。
- CLI `@file` 改用 `runtime-tools` 的中立 `resolveExistingPath`，保留当前目录、绝对路径、用户目录与文件读取行为。
- Product Tools Composition Root 显式组合上述能力；工具描述、Schema 和业务实现保持不变。

## 旧实现依赖变化

| 指标 | 第 227 阶段 | 本阶段 | 最终目标 |
| --- | ---: | ---: | ---: |
| 生产代码到旧实现的精确依赖边 | 204 | 197 | 0 |
| Tool 域旧依赖 | 24 | 17 | 0 |
| Runtime 包到 `coding-agent` 的反向依赖 | 0 | 0 | 0 |
| 明确登记的旧实现文件 | 182 | 182 | 0 |
| 保留的旧格式边界 | 8 | 8 | 按迁移需求审计 |
| 旧格式边界到旧实现的依赖 | 3 | 3 | 0 |

本阶段删除 7 条生产依赖：Desktop Command Host 到旧子进程实现 1 条、Product Tools Runtime 到旧文档转换/子进程/OCR 限流实现 3 条、Edit/Write 路径政策到旧路径工具 2 条、CLI 文件处理到旧路径工具 1 条。

## 行为兼容性验证

- 异步 Gate 合同覆盖 FIFO 并发上限和失败后释放。
- 命令进程 Host 覆盖成功输出、非零退出及取消。
- 文档转 PDF Operations 覆盖不支持平台、Office/WPS 探测、转换成功和失败。
- 路径政策覆盖 Skill/Scene/Knowledge/Wiki 的保护根、相似前缀和普通路径。
- Product Tools、图片阻断、Read/Write/Edit Runtime 既有合同通过。
- 真实 CLI Print Mode 的 18 项测试通过，包含 `@file` 兼容入口。

针对性测试：

```text
packages/runtime-tools: async gate + product/read/write/edit contracts — 63 passed
packages/coding-agent: process/doc/path/product/block-images contracts — 26 passed
packages/cli-app: agent-print-mode.test.ts — 18 passed
bun run check:quick — passed
bun run check — passed（Biome、monorepo/CLI/Desktop/Admin 类型检查与全部 guards）
```

## 尚未完成的替换

- 仍有 197 条生产代码到旧实现的精确依赖，目标为零。
- Tool 域剩余 17 条依赖，需要继续按工具合同、产品 Operations 与宿主 Adapter 分批替换，不能借迁移改变功能。
- 旧实现文件仍为 182 个；必须先建立独立生产替代和行为合同，再删除对应实现。
- 唯一旧 SDK 示例、8 个旧格式边界及其中 3 条旧实现依赖尚未归零。
