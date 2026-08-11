# 第 296 轮：宿主基础设施适配器生产化

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

第 295 轮已经使旧执行路径和迁移期兼容垫片归零，但 Runtime Tool Adapter 仍包装 `src/utils/tools-manager.ts`，命令宿主和沙箱仍依赖 `src/utils/shell.ts`。这些文件不是第二套 Agent Runtime，却让新端口继续依赖旧 utility 所有权，且不在既有残留门禁覆盖范围内。

本轮将网络、文件系统、归档、Shell 和进程能力确立为正式宿主基础设施 Adapter，不改变 Runtime Tools 的领域所有权。`@vetta/runtime-tools` 继续只持有工具实现和 `CodingToolExecutableResolver` Port，Coding Agent 负责把本机与网络能力适配到该 Port。

## 实施内容

### 受管可执行文件

- 在 `adapters/runtime-tools/executables` 按发布资产目录、网络边界、归档安装和受管解析器拆分实现；
- 正式 Resolver 直接实现 `@vetta/runtime-tools` 的 `CodingToolExecutableResolver`，不再声明重复 Port；
- 删除旧 `utils/tools-manager.ts` 和只转发 `ensureTool` 的 `adapters/runtime-tools/executable-resolver.ts`；
- 保留本地安装优先、PATH 查找、离线模式、Android/Termux 拒绝下载、GitHub Release 查询、超时/传输失败重试、HTTP 错误不重试、唯一解压目录、归档清理和失败降级语义；
- `@vetta/coding-agent/host` 使用 Managed Resolver 名称暴露正式宿主 API，移除迁移期重复类型。

### 命令执行基础设施

- Shell 发现、设置读取、PowerShell UTF-8 前缀和 PATH 组装迁入 `host/command-execution/shell-runtime.ts`；
- 二进制输出清理与文本解码迁入 `command-output.ts`；
- 跨平台进程树终止迁入 `process-tree.ts`；
- 前台命令、后台命令、本地 Bash 和三个平台沙箱切换到正式宿主模块；
- 删除 `utils/shell.ts`，清除 workspace guard 的迁移期 Adapter 描述。

### 类型校验判断

GitHub Release API 响应是外部不可信结构化数据，本轮用 TypeBox Schema 和 `Value.Check` 校验 `tag_name`。下载字节、文件路径、进程输出和内部静态合同不适合 Schema 校验，继续使用原生类型和明确的 I/O 边界。

## 防回退门禁

迁移残留门禁新增三项零基线：

- `retiredInfrastructureFiles=0`：旧 tools manager、Shell utility、转发 Resolver 和旧测试文件不得恢复；
- `runtimeAdapterUtilityBackedgeFiles=0`：Runtime Adapter 不得重新导入 `src/utils`；
- `legacyInfrastructureAdapterLabels=0`：不得用 legacy downloader/runtime adapter 措辞重新包装旧实现。

门禁使用实际模块导入解析和精确文件清单，不限制与本阶段无关的普通 utility，也不误判历史 Session 数据边界。

## 旧实现依赖变化

- `src/utils/tools-manager.ts`：`1 -> 0`；
- `src/utils/shell.ts`：`1 -> 0`；
- 只做转发的 Runtime Tool Resolver Adapter：`1 -> 0`；
- 命令宿主与 Runtime Adapter 到上述旧 utility 的依赖：`7 -> 0`；
- Runtime Tools 对 Coding Agent 的反向依赖：保持 `0`；
- 旧 Agent 执行边：保持 `0`；
- 历史会话兼容边界：保持 14 个且全部已分类；
- 工具与命令用户可见功能变化：`0`。

## 行为兼容性验证

- 工具下载、版本响应、归档和命令宿主定向测试：5 个文件、34 项通过；
- 迁移残留门禁测试：28 项通过，新增三项指标均为 `0`；
- Coding Agent 全量测试：137 个文件、935 项通过，另有 1 个文件、17 项按既有条件跳过；
- CLI 全量测试：34 个文件、183 项通过；
- `bun run check:quick` 通过；
- 根级 `bun run check` 通过，包括 Biome、Root/CLI/Desktop/Admin 类型检查和全部质量守卫；
- 本轮未发送外部真实模型请求；工具下载使用可注入 HTTP 边界测试，CLI 独立产物继续验证正式组合根。

## 尚未完成的替换

本轮识别的旧宿主 utility 和转发 Adapter 已全部替换，没有延期项。保留的 `adapters` 目录承担真实依赖倒置：把网络、文件系统、进程、Extension 和产品状态适配到 Runtime Port，不是旧架构兼容层。
