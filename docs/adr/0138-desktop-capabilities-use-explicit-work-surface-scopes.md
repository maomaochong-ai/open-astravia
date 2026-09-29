# Desktop 能力使用显式工作表面作用域

## 背景

Desktop 的普通会话长期以 `activeSessionAtom` 同时提供 `sessionPath`、`runtimeId`、`cwd`、
Fork 谱系和 Agent 展示身份。消息生命周期确实需要 Conversation 身份，但终端、底部面板、
活动面板、后台任务徽标和 Sandbox 授权只分别需要工作区、工作表面或 Runtime。它们直接读取
`activeSessionAtom` 后，Team 这类多 Runtime 宿主若不写入普通会话全局状态，就无法安全复用这些
能力；若伪造一个普通会话，又会让操作落到残留或任意选中的 Runtime。

ADR-0125 最初让底部面板的“当前主键”直接复用输入草稿的当前主键。这保证了普通会话内的一致性，
但也把两个生命周期不同的领域绑在一起，使 Team 无法拥有独立的底部面板。

## 决策

### 长驻工作 UI 使用显式 `WorkSurfaceScope`

底部面板及终端入口接收由页面 Connector 创建的 `{ key, cwd, scenario }`：

- 普通会话使用 `sessionPath` 作为 key，保持已有布局持久化兼容；
- Team 使用 `agent-team:<teamSessionId>`，团队全景与成员视图共享同一工作表面；
- `cwd` 只代表文件系统根，`scenario` 只用于插件贡献过滤；二者不再从当前普通会话推断。

底部面板的 Jotai 状态继续集中持久化，但读取和写入 Atom 按显式 key 参数化。输入草稿与底部面板
可以采用相同 key 值，却不再共享“当前 scope”Atom。本决策取代 ADR-0125 中“底部面板主键与输入
草稿当前主键同源”的实现约束；ADR-0125 的会话级持久化、折叠不卸载和终端生命周期取舍仍有效。

### Runtime 能力接收一个或多个 Runtime ID

后台任务和 Sandbox 授权不读取 `activeSessionAtom`。普通会话传一个 Runtime；Team 根据当前视图传
协调 Runtime 与成员 Runtime，或在成员视图中只传该成员 Runtime。聚合展示允许多 Runtime，撤销等
定向命令必须保留资源所属 Runtime，不静默选择 leader、协调 Runtime 或数组第一项。

### 页面 Connector 通过 JSX 组合静态能力

普通会话与 Team 分别组合 Export、Pin、Terminal、Bottom Panel 和 Activity Panel 叶子组件。不存在
统一的 `showX` 能力表或万能 Conversation Context：

- Pin 只依赖窗口；
- Export 接收 transcript 与 participants；
- Terminal 接收工作表面；
- 后台任务和授权接收 Runtime IDs；
- Activity Panel 接收 `ActivityWorkspace`。

展示叶子不读取业务 Atom。页面 Connector 可以选择不挂载某项能力，或为同一能力提供不同适配器。

## 备选方案

- **让 Team 写入伪造的 `activeSessionAtom`**：改动小，但多 Runtime 无法无损压成一个 `runtimeId`，
  还会让普通会话生命周期、草稿和通知错误地认为 Team 是普通会话。
- **拆成多个 `activeCwdAtom` / `activeRuntimeIdAtom`**：降低部分重渲染，但仍由叶子隐式读取全局当前值，
  页面切换时还可能组合出不同宿主的数据。
- **建立统一 `ConversationContext` 能力对象**：能减少 Atom import，却把不同生命周期重新装进一个大
  Context，并迫使项目页、只读页和 Team 伪装成同一种 Conversation。

## 后果

- Team 会话可以安全展示导出、窗口置顶、终端和底部面板入口；输入栏折叠药丸与页内面板使用同一
  Team 工作表面。
- Team 导出使用当前投影后的消息和参与者，不额外读取成员私有 Runtime 历史。
- 普通会话的底部面板持久化 key 保持为原 `sessionPath`，已有布局无需迁移。
- 参数化 Atom 会按使用过的工作表面缓存 Atom 配置；实际布局状态仍受原持久化上限管理。
- `activeSessionAtom` 暂时继续承担普通 Conversation 的打开、恢复、消息和标题适配；相邻能力迁移时应
  继续收缩其消费者，而不是新增新的隐式读取。
