# ADR-0092：MCP Ability 使用声明式受管运行时，不执行安装脚本

## 状态

Accepted（2026-08-30）

修订 [ADR-0049](./0049-abilities-unify-storage-and-presentation-not-installation.md) 中“MCP 只写入 `mcp.json`”的物理安装描述；
Ability 的统一边界与 MCP 独立安装轨道不变。

## 背景

MCP 规范统一的是 Client 与 Server 的通信，不规定 Server 二进制、Node/Python 包、浏览器组件和用户数据如何安装。
因此一个协议标准的 MCP 仍可能要求用户安装运行时、执行项目专用脚本、下载大体积二进制并手工填写路径。若 Desktop
为每个市场 MCP 编写专用安装代码，安装、升级、卸载、安全校验和诊断会持续分叉；若允许市场执行任意 shell、
PowerShell 或 JavaScript 安装脚本，则市场数据会变成不受控的代码执行入口，也无法可靠回滚。

Desktop 已由 ADR-0011 管理 Node/Python 运行时并重定向包源，Open Marketplace 也已经对归档、路径和能力包做严格校验。
缺口位于 MCP Ability 的可执行产物生命周期，而不是 MCP 协议运行时。

## 决策

1. `mcp.json schemaVersion: 2` 可以声明一个可选的 `runtime`。首期唯一 provider 是 `managed-binary`：按
   `win32|darwin|linux` 与 `x64|arm64` 选择 HTTPS 产物，要求字面量 SHA-256，并支持单文件或 ZIP。
2. 市场清单不得声明或执行安装脚本。ZIP 拒绝绝对路径、目录逃逸、符号链接、加密条目、过多条目和超量展开；下载
   有大小与超时上限。Server 的 `command` 必须精确等于 `${VETTA_MCP_EXECUTABLE}`，由主进程安装完成后解析为绝对路径。
3. 运行文件按 Ability 来源、slug 和版本隔离，落在 `~/.vetta/abilities/mcp/<identity>/runtime/versions/<version>/`。
   `data/` 与 `cache/` 位于版本目录之外；更新运行时不能覆盖 Cookie、登录态和其它用户数据。
4. 安装采用同盘 staging。下载、哈希、解包、可执行文件存在性和权限校验全部完成后才替换目标版本；失败保留已安装
   版本。卸载只删除 `runtime/`，默认保留 `data/` 与 `cache/`。
5. 安装器属于 Desktop 的 Ability 领域。`@vetta/runtime-mcp` 继续只消费标准 stdio/HTTP 配置，不感知市场、下载或安装。
   IPC 只负责输入校验和调用领域服务。
6. 现有 `schemaVersion: 1`、远程 HTTP 和普通 stdio 配置保持兼容。Node/Python MCP 继续受益于 ADR-0011 的托管运行时；
   在获得足够真实包样本、能够定义锁定依赖和无任意脚本的可复现合同前，不新增万能 package recipe。

## 运行时占位符

- `${VETTA_MCP_EXECUTABLE}`：只能作为 `server.command` 的完整值，也可在参数或环境变量中引用。
- `${VETTA_MCP_RUNTIME_DIR}`：当前版本的只读运行目录。
- `${VETTA_MCP_DATA_DIR}`：跨版本保留的用户数据目录。
- `${VETTA_MCP_CACHE_DIR}`：跨版本的可再生成缓存目录。

主进程在安装时解析这些值，最终写入的仍是普通 MCP stdio 配置，不把安装合同传入 Agent Runtime。

## 后果

- 自包含 Go/Rust 等 MCP 可以一键安装、校验、升级和卸载，不要求用户预装 CLI 或手工配置路径。
- 市场作者必须为支持的平台发布稳定产物并提供 SHA-256；不能发布预编译产物的项目仍使用普通 stdio/manual 形式。
- 首期不支持 tar、容器、系统包管理器、原生编译工具链和任意安装脚本。这是安全与可维护性边界，不是遗漏。
- 安装进度首期复用 Ability 的 busy/error 状态；若真实大文件体验需要分阶段进度，后续在同一领域服务增加事件合同，
  不改变 `mcp.json` 格式。

## 考虑过的方案

- **每个 MCP 编写安装器**：短期直接，长期形成重复状态机与不可统一的升级/卸载行为，拒绝。
- **执行市场提供的 install script**：覆盖面最大，但等价于授予任意代码执行且难以审计、取消和回滚，拒绝。
- **所有 MCP 使用容器**：环境一致，但普通用户需要额外安装和维护容器运行时，包体、启动成本和平台问题更高，
  不作为 Desktop happy path。
- **一次性支持 Node/Python/容器的通用 recipe DSL**：没有足够样本证明合同边界，会提前造出新的包管理器。选择先落地
  自包含二进制 provider，再按真实重复模式扩展封闭的 provider 联合。
