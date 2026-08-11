# 阶段 223：动态 Skill / Extension Resource Source

## 目标

在不改变既有 Skill 与 Extension 功能语义的前提下，为稳定 SDK 增加运行时可变资源来源，使宿主能够动态提供 Skill 内容、Skill 路径和 Extension 路径，并由 Session 统一管理刷新与释放生命周期。

## 实施前分析

既有资源加载能力已经由 `DefaultResourceLoader` 负责，Extension 的替换也已有事务化 reload 边界。因此，本阶段不新增第二套 loader，也不恢复旧 `AgentSession`、Registry 或包根 API；稳定 SDK 只需要一个窄的 Source 合同与宿主适配层。

关键约束如下：

- 运行中的 Turn 必须使用启动时确定的能力集合；资源失效不能修改当前 Turn。
- `steer()` 与 `followUp()` 属于当前执行链，不触发能力刷新。
- 下一次普通 `prompt()` 可消费失效通知；宿主也可以显式调用 `reload()`。
- Skill 内容可以由 SDK 直接提供，不要求创建临时文件。
- Extension Source 只提供路径；内联 Extension factory 继续作为兼容 API，不扩大稳定 SDK 合同。
- Source 的订阅取消和 `dispose()` 由 Session 生命周期统一负责。

## 架构决策

### 1. Source 提供版本化快照

新增公开 `CodingAgentSkillSource` 与 `CodingAgentExtensionSource`。Source 通过 `read()` 返回带 `revision` 的不可变快照，通过可选 `subscribe()` 仅发送失效通知。

失效通知不携带完整资源，也不立即重建运行时。宿主在安全边界重新读取 Source；revision 未变化时不执行替换。这样既允许本地文件被删除、工具或 Skill 被移除，也避免在模型运行期间修改当前 Turn。

### 2. Skill 与 Extension 使用不同的最小刷新路径

- 仅 Skill 变化：更新额外路径与内容变换，然后调用定向 `reloadSkills()`。
- Extension 变化：复用既有事务化完整 reload，使 Extension、工具注册与相关运行时状态保持一致。
- 显式 `session.reload()`：强制读取全部 Source，再进入既有完整 reload。

### 3. 声明式策略位于贡献边界

Skill Source 快照支持 `include` / `exclude` 策略，选择条件包括名称、名称片段、来源和类型。策略只决定 Source 贡献进入最终 Skill 集合的方式，不渗入 Agent 内核执行循环。

### 4. 本阶段不引入 TypeBox

Source 是进程内受信任的 TypeScript 回调和值合同，没有 JSON、IPC 或不可信配置输入。TypeScript 类型已经足以约束该边界；文件与 frontmatter 等外部输入仍沿用既有解析和校验路径。当前引入 TypeBox 只会增加重复 schema，不能提高实际运行时安全性。

## 实施内容

### 公开合同

- 新增动态 Skill / Extension Source、revision、失效订阅、Skill contribution 与声明式 policy 类型。
- `createCodingAgentSession()` 新增 `skillSources`、`extensionSources`，资源贡献新增内联 `skills` 与 `skillPolicy`。
- 稳定 Session 新增只读 `getSkills()`，用于宿主观察当前已生效 Skill，不暴露内部 loader。
- 将新合同纳入公开 SDK 边界测试。

### 宿主与资源适配

- 新增 `CodingAgentSdkResourceSourceAdapter`，负责初始读取、revision 比较、失效合并、串行刷新、路径去重、内联 Skill 投影和资源释放。
- Session 创建失败和正常关闭都释放 Source；取消订阅与 `dispose()` 保证只执行一次。
- 普通 `prompt()` 前只刷新已经失效的 Source；streaming steer 不刷新。
- 新增 `readSkills` 窄端口，避免稳定 Session 直接依赖 `DefaultResourceLoader`。

### 内核兼容改动

- 内部 Skill 增加可选内联内容，并统一通过 `readSkillContent()` 读取。
- Skill 展开与 `invoke-skill` 同时支持文件内容和内联内容，原有文件 Skill 行为不变。
- `ResourceLoader` 增加额外 Extension 路径设置与定向 `reloadSkills()`；既有完整 reload 仍是 Extension 替换边界。

### 示例和说明

- Skill 示例改为稳定 SDK，展示内联贡献、策略、动态 Source、显式 reload 与 `getSkills()`。
- Extension 示例改为通过稳定 SDK Extension Source 提供路径。
- 稳定 SDK 文档补充刷新时机、Turn 一致性、移除语义和释放责任。
- CHANGELOG 记录新增稳定 SDK 能力。

## 功能保持检查

本阶段没有删除或改写以下功能：

- 文件系统 Skill 扫描、frontmatter 解析和 Skill 调用语义。
- Extension 模块加载、事件处理、工具注册和事务化 reload。
- 内联 Extension factory 兼容入口。
- MCP、认证、设置、会话存储和模型执行流程。
- 现存的兼容格式边界与包根导出策略。

## 验证记录

- 动态资源定向测试：4 个测试文件、23 个测试通过。
- 覆盖内联 Skill、声明式 policy、revision 刷新、Skill/Extension 移除、显式 reload、普通 prompt 自动刷新、steer 不刷新以及 close 释放。
- `bun run check:quick`：通过。
- `bun run check`：通过；覆盖 Biome、根 monorepo 类型、CLI、desktop-app、admin 与全部质量守卫。

## 后续方向

下一阶段应回到内核边界收口：审计 runtime-storage 与 runtime-tools 对宿主/旧层的反向依赖，通过窄端口和 composition root 倒置所有权。该阶段仍以保持功能和既有会话事件兼容为前提，不提前删除包根兼容 API。
