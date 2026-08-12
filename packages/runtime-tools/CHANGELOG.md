# Changelog

All notable changes to `@vetta/runtime-tools` are documented in this file.

## [Unreleased]

### Breaking Changes

- **CodingToolCatalog 执行仲裁合同**：`resolve(toolName)` 返回带稳定 Capability Binding 的 Catalog Entry，只读 Catalog 新增 `execute(binding, request)`；Coding Tools 不再写入编译期 `RuntimeSnapshot.tools`，改为通过 Model Call Contribution 在每次模型调用前物化。
- **退役 Coding Agent 工具兼容根**：包根改为暴露与 `@vetta/runtime-tools/coding` 相同的原生 Runtime Tool API，不再提供旧工具单例集合与旧工厂转发。

### Changed

- **`agentModes` / `agentMode` 字段整体删除（ADR-0071，接续上一条）**：`CodingToolRegistration.agentModes` 与 `CodingToolActivation.agentMode` 不再存在，6 个内置工具的 `*_TOOL_AGENT_MODES` 常量删除。上一版把 agent_mode 从过滤降级为「宿主排序偏好」，本版确认排序对模型选择无可观察影响后整体废弃：工作模式不以任何形式参与工具选择与排序，`scopeUse` ∩ `requires` 仍是仅有的两条 fail-closed 轴。

### Added

- **Turn-bound Tool Catalog lease 与显式 hard revoke**：Turn admission 捕获不可变 Catalog 与具体
  implementation binding；普通 disable/unregister/reload 只影响后续 Turn，旧 binding 保留到最后一个
  Turn lease 释放。`revoke` 强制要求 reason 与 audit id，并可取消在途执行。
- **原生 Subagent 控制 Tool**：新增 `spawn_agent`、`dispatch_workflows`、`wait_agent`、`list_agents`、`interrupt_agent`、`send_message` 与 `followup_task` 的 TypeBox Schema、TS 描述和 Registration；工具协议与用户可见行为保持不变，执行只依赖 `runtime-subagents` 的协调端口。
- **原生 Knowledge 写页 Tool**：新增 `kb_write_page` 的 TypeBox Schema、TS 描述、Registration 与知识写入窄 Operations Port；工具名称、scope、输入、输出和移动提示保持不变。
- **原生 IM 附件 Tool**：新增 `im_send_attachment` 的 TypeBox Schema、TS 描述、Registration 与宿主发送/文件访问窄 Port；工具名称、scope、输入、输出及错误语义保持不变。
- **原生能力 Tool 合同**：新增 `ask_user_question`、`invoke_skill`、`memory`、`todo`、`tool_search` 与知识标签查询 Tool；TypeBox Schema、TS 描述、Registration 和执行协议由 `runtime-tools` 持有，宿主状态与查询通过窄 Operations Port 注入。
- **中立宿主执行原语**：新增可注入的 FIFO 异步执行 Gate 与既有路径解析导出，供产品组合根实现并发限制和 `@file` 路径兼容，不依赖 `coding-agent` 旧实现。
- **可等待的后台命令关闭合同**：`BackgroundCommandService` 新增 `shutdown()`，停止全部运行任务并等待宿主进程退出回调；同步 `dispose()` 兼容入口、任务状态、通知和停止原因保持不变。
- **Greenfield Coding Tools Feature**：新增 `@vetta/runtime-tools/coding`、`createCodingToolsFeature` 和 TypeBox 驱动的 `current_time` Runtime Tool。
- **Coding Tool 注册层**：分离 Runtime Tool 执行定义与 `scope_use`、`category` 暴露元数据，并新增可复用旧新工具差分合同。
- **Read 行为合同**：新增参数化旧新行为合同，覆盖路径、编码、图片、二进制提示、锚点、截断、自定义 Operations 和取消。
- **Greenfield Read Tool**：新增独立 Runtime read、Coding 注册和可注入文件/图片 Port，并在旧新差分验证通过后接入 Greenfield Coding Tools Feature。
- **Greenfield Ls Tool**：新增独立 Runtime ls、参数化旧新行为合同和可注入目录 Operations；保留旧工具空 `scope_use` 的默认不激活语义，并通过真实 Agent Core Tool Loop 验证显式执行。
- **Greenfield Grep Tool**：新增独立 Runtime grep、TS 描述、注册层和可注入文件读取边界；保留 ripgrep 搜索、上下文、锚点、匹配限制、截断和取消合同。
- **Greenfield Find Tool**：新增独立 Runtime find、TS 描述、注册层和可注入 glob 边界；保留空 `scope_use`、路径相对化、`.gitignore`、结果限制、截断和显式激活合同。
- **Greenfield Glob Tool**：新增独立 Runtime glob、TS 描述、注册层和可注入 glob Operations；保留绝对模式、相对路径、目录标记、`.gitignore`、去重、结果限制和截断合同。
- **Greenfield Dir Tree Tool**：新增独立 Runtime dir_tree、TS 描述、树模型、注册层和可注入 fd Operations；保留层级、排序、子节点计数、深度、节点/扫描/字节限制和全场景暴露合同。
- **Greenfield Write Tool**：新增独立 Runtime write、TS 描述、注册层、可注入文件 Operations 和宿主路径政策；保留路径模糊重定向、父目录创建、写保护、协作式取消和全场景暴露合同。
- **Greenfield Edit Tool**：新增独立 Runtime edit、TS 描述、锚点与精确文本编辑引擎、可注入文件 Operations 和宿主路径政策；保留原子批量编辑、模糊匹配、结构闭合保护、BOM/换行、diff、取消和全场景暴露合同。
- **宿主可执行文件解析 Port**：新增 `CodingToolExecutableResolver` 及本地 PATH/受管 bin 目录 Adapter；Runtime 不负责下载、版本选择或日志输出。
- **动态 Coding Tool Catalog**：新增版本化 `CodingToolCatalog`、可变 `CodingToolRegistry`、注册/注销、重名冲突和 scope/显式激活选择；每次模型调用读取不可变成员视图。
- **Coding Tool 生命周期与在途执行跟踪**：Registry 新增 activate、deactivate 和 revoke；deactivate 只阻止新调用，revoke 会轮换 revision、协作取消在途执行并返回结构化不可重试错误，unregister 不隐式终止已经开始的副作用。

### Changed

- **`invoke_skill` 读取回调上下文**：`readBody` 现接收完整 `RuntimeToolExecutionRequest`，使宿主可按 `toolCallId` 将 Skill 文档解析与当前工具事务关联，原有 Skill 文本结果保持不变。
- **Coding Tool 结果策略合同**：Catalog 在执行跟踪边界统一应用可注入 `CodingToolResultPolicy`，默认 Preserve Policy 保持完整结果；产品组合可实现容量保护而无需让 Runtime Tools 依赖具体文件存储，撤销、取消和动态绑定语义不变。
- **Subagent 通知投影所有权**：模型可见通知文本由 Runtime Tools 生成，通用 Subagent 调度内核只交付终态快照；通知格式、工具提示和交付语义保持不变。
- **Coding Tools 调用级动态能力源**：Feature 支持在每次模型调用前刷新外部 Catalog、解析 activation 并执行 registration filter；局部工具变化无需重编译 Snapshot，显式激活也不能绕过宿主硬隔离策略。
- **Coding Tool 调用级动态解析**：Coding Tools Feature 不再在 prepare 时固定 Catalog 成员；每次模型调用读取最新注册集合，执行前再次校验工具仍存在且定义未替换，普通注册变化无需全量重编译 Runtime Snapshot。
- **Coding Tool 绑定改用稳定 revision**：模型调用 Frame 保存 `sourceId + capabilityId + revision`，不再以 JavaScript 对象引用判断工具是否替换；Catalog 原子完成状态校验和在途执行登记。
- **Coding Tools Feature 装配边界**：`CodingToolsFeatureOptions` 不再逐项暴露 current_time/read/ls Options，改为接收只读 Catalog 与激活策略；工具依赖和 Options 由组合根创建注册对象时注入。
- **Grep 宿主依赖边界**：Runtime grep 不再导入 `coding-agent` 的 `ensureTool` 下载器；组合根通过 `rgPath` 注入宿主可执行路径，Runtime 包只负责搜索协议和结果格式化。
- **Find 宿主依赖边界**：Runtime find 不再导入 `coding-agent` 的 `ensureTool` 下载器；组合根通过 `fdPath` 注入宿主可执行路径，Runtime 包只负责路径匹配协议和结果格式化。
- **Glob 宿主依赖边界**：Runtime glob 不再导入 `coding-agent` 的 glob 实现；Runtime 包直接声明 `glob`/`ignore` 依赖，宿主只负责提供工作目录和可选 Operations。
- **Grep/Find 路径解析注入**：`grep` 和 `find` 可选接收宿主解析器，并在执行时解析 `rg`/`fd`；未注入解析器时保留原有 `rg`/`fd` 默认路径和错误行为。

### Fixed

- **`current_time` 兼容性**：恢复旧工具的完整模型描述、Schema 宽容度和直接执行语义，并增加旧新差分测试。
