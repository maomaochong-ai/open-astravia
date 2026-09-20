# SSH 远程项目与执行边界

## 背景

项目身份此前等同于一个本地绝对路径：`ProjectEntry` 只有 `path`，`sameProjectPath()` 把路径归一化后直接比较，会话 cwd、活动标签 keying 和文件树授权根全部建立在「cwd 字符串唯一且指向本机」这个假设上。用户要在远程主机上开发时，只能把仓库同步到本地，或者完全绕开 Vetta。

Desktop 的 UI 文件层集中在 `filesystem-service.ts`，但它直接调用 `node:fs`，没有后端抽象。Agent 侧相反：`CodingAgentToolEnvironmentFactory` 与各工具的 `*Operations` 端口已经是干净的注入点，ADR-0075 也明确写了「后续平台使用独立 Runtime 包实现同一协议」。

调研了三种业界形态：

- **远端完整 Server**（VS Code Remote-SSH、JetBrains Gateway）：体验最全，但远端进程很重；VS Code Server 不开源且许可禁止第三方使用。
- **远端常驻 relay 守护进程**（Zed、Orca）：远端跑一个自带协议的守护进程，终端、git、监听、搜索全部在远端原生执行，断线后远端工作继续存活。代价是远端交付成本高——Orca 因为 relay 依赖 `node-pty` 与 `@parcel/watcher` 两个原生模块，不得不在远端现场 `npm install`，并为此维护远端 Node 探测、原生依赖缓存与修复、安装锁与 GC 等一整套机制。
- **SSH 作为工具**（LiveAgent）：项目仍是本地的，SSH 是终端标签页的一种，Agent 通过一个 `SSHManager` 元工具访问远端。改造成本最低，但模型必须自己区分本地与远端路径，且它的低成本来自「已有终端子系统」这一前提。

Vetta 当前没有终端、没有 Git 面板、没有 LSP、没有端口转发。这既排除了 LiveAgent 路线的成本优势，也意味着不需要为它们付 relay 的代价。

## 决策

采用**本地大脑 + 远端工具**：Agent 循环、模型调用、凭据、会话存储、MCP、插件、技能、审批 UI 全部留在本机主进程；只把接触「项目在哪台机器上」的那一层换成 SSH 实现。

### 项目身份

`ProjectEntry` 的位置字段改为判别联合：

```text
{ kind: "local"; path }  |  { kind: "ssh"; hostId; remotePath }
```

对外统一用规范化 URI `ssh://<hostId>/<abs-path>` 作为 cwd 字符串，使既有的「cwd 即主键」逻辑（会话映射、活动标签 keying）保持不变，只有真正执行 I/O 的边界才解析 URI。项目身份比较改为 `(hostId, path)` 二元组，路径大小写敏感性由该主机的远端平台决定，不再统一按本机规则归一化。

### 执行边界

两条不可协商的规则，适用于所有远程项目代码路径：

1. **不得静默回退到本地执行。** 对远程 cwd 的文件或命令操作，在 SSH provider 缺失、连接断开或任何错误下都必须失败并报错，绝不改为在本机执行。本机存在同名路径时，本地执行会针对完全错误的仓库给出看似成功的答案。
2. **不得断言无法观察的状态。** 进程与连接状态固定为 `live` / `unverifiable` / `exited` 三态，不允许同义词，不允许把 `unverifiable` 并入任何一侧。判定 `exited` 必须有来自远端的正面证据；传输层故障只能产生 `unverifiable`。

### 传输层

以系统 OpenSSH 二进制为主路径，每主机一条 `ControlMaster` 复用连接。理由是 `~/.ssh/config`、Include、ProxyJump、ProxyCommand、ssh-agent、FIDO 安全密钥、GSSAPI、known_hosts 全部由 OpenSSH 原生支持——用户只要 `ssh host` 能通，Vetta 就能通。传输层定义为接口，Windows 或无系统 ssh 的环境后续可补 `ssh2` 实现。

交互式提示（口令、2FA、主机指纹确认）通过自制 askpass 程序接回 Vetta UI。

### 远端交付

第一阶段远端零安装，全部操作由 `ssh exec` 与 SFTP 完成。第二阶段引入远端 helper 时，采用静态单文件二进制（Go 或 Rust musl），由本地经 SSH 上传并校验摘要，不要求远端具备 Node 或任何运行时。

helper 的安装目录与握手版本使用**语义化协议版本号**，不使用构建内容哈希。按构建哈希命名会让每次应用升级后的新客户端连不上仍在运行的旧守护进程，旧会话永久失联且无法在原理上恢复。

### 安全边界

- 主机密钥首次连接必须由用户确认指纹，变更时硬性阻断，不提供 `StrictHostKeyChecking=no` 开关。
- 凭据复用既有 `CredentialVault` 与 `safeStorage`，配置内只存 `credentialRef`，不存明文口令。
- keyboard-interactive / MFA 主机，Agent 不得自行发起连接，必须由用户在 UI 完成认证。
- agent forwarding 默认关闭，按主机显式开启并提示风险。
- 本机环境变量不透传远端；远端凭据使用远端自身配置。
- helper 以登录用户身份运行，不提权，仅通过 stdio 通信，不监听 TCP。

## 迁移策略

按行为保持与行为变化分离推进：

1. **前置重构**（行为不变，可独立发版）：项目写入收口到 `ProjectService`；引入 `ProjectLocation`；`filesystem-service` 抽出 `WorkspaceFileSystem` 接口与本地实现；ripgrep 执行收进可注入端口。
2. **SSH 可用形态**：`ssh-transport` 连接管理与主机模型；`SshFsBackend`；`runtime-ssh` 实现各工具 `*Operations` 端口；设置页与添加项目入口。
3. **远端 helper**：静态二进制、文件监听、内置搜索、单次往返编辑；`ssh exec` 路径保留为降级方案。

迁移期间不得引入第二套 Agent 执行路径：远程与本地共用同一 Kernel、同一工具逻辑，差异只存在于注入的 `*Operations` 实现。

## 备选方案

- **远端完整 Runtime**：把 Vetta Kernel 搬到远端，可获得「本机关机后远端继续跑」。代价是远端需要 Node 运行时，模型密钥与会话存储落到远端，且需要维护远端安装与升级链路。当前不采用；若日后该能力成为硬需求，需要另立 ADR 重新评估。
- **SSHFS / 网络挂载**：远端进程写入不触发 inotify，而 Agent 恰是远端进程；大仓库逐文件 stat 极慢；macOS 需要 macFUSE。不采用。
- **SSH 作为 Agent 工具**：不改项目模型，仅新增一个远程操作元工具。模型需自行区分本地与远端路径，文件树与编辑器仍指向本地，且 Vetta 缺少让该方案变便宜的终端子系统。不采用。

## 后果

- 项目位置成为显式的一等概念，`kind` 的引入使编译器能定位所有隐含「路径即本地」假设的调用点。
- 模型密钥、会话历史、插件与 MCP 生态不受远程化影响；远端主机被回收后本地会话仍然完整。
- 远端零安装，对共享服务器与受控跳板机友好。
- **本机断开时当前回合中断**：前台命令随 channel 关闭终止，后台命令通过 `setsid` 托管继续存活，会话在本地可续接。这是本决策的结构性限制。
- 本机沙箱（seatbelt / bubblewrap）对远端命令无效，远程会话需向用户明示无沙箱并采用更保守的默认审批策略。
- MCP 服务器与插件运行在本机，无法访问远端项目；宿主需按执行边界规则拒绝把远端 cwd 交给本机执行类能力，并在系统提示词中说明。
- 每次工具调用增加一次网络往返；`edit` 需要读写两次往返，在高延迟链路上可感知，由第二阶段 helper 合并为一次。
