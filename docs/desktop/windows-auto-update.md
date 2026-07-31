# Windows 自动更新、R2 发版与排障

本文记录 Vetta Desktop Windows 自动更新从服务端发版迁移到 R2/GitHub Releases 的最终方案、实现细节、完整验证流程，以及开发期间遇到的问题。它是当前 Windows 更新链路的维护手册。

## 1. 当前结论

Windows 当前采用以下组合：

- `electron-updater`：检查 `latest.yml`、版本比较、SHA-512 校验、blockmap 差分下载和下载缓存。
- Inno Setup：首次安装、手动修复安装，以及后台把新版本展开到独立版本目录。
- 稳定启动器：从版本指针选择当前版本，并在新版本首次启动失败时回退。
- R2 + Cloudflare 自定义域名：官方版本的静态更新源。
- GitHub Releases：开源版本可选更新源。

更新源是**构建期配置**。客户端不依赖业务 API 保存版本、代理安装包或决定更新地址。同一套代码可以构建为 R2、GitHub Releases 或不带更新源的包。

Windows 只需要发布一个 EXE 安装包及其 blockmap，不需要为了自动更新再发布 ZIP。

> 这里常被简称为 A/B 更新，但严格来说是“并排版本目录 + 当前/上一版本指针”，不是两个固定槽位。

## 2. 设计目标与边界

### 2.1 已实现

- 更新目标源不与 Vetta 平台绑定。
- R2 与 GitHub Releases 使用相同的客户端更新状态机。
- Windows 安装与后台更新统一使用 Inno Setup EXE。
- 后台更新不显示安装向导，不修改卸载注册信息，也不强制关闭正在运行的旧版本。
- 下载完成后先准备完整的新版本目录，用户点击“更新并重启”时只切换指针并启动新 EXE。
- 当前版本启动成功后保留“当前版本 + 上一版本”，清理更老版本。
- 使用 blockmap 和本地安装包基线做差分下载。
- 发布新清单前先上传并公开验证其引用的产物，避免客户端看到半发布版本。

### 2.2 当前边界

- 本文的版本目录切换和 Inno 后台准备只适用于 Windows。
- 当前未接入 Windows 代码签名，SmartScreen 可能显示未知发布者。
- 更新源不能在应用运行时随意切换；它写在打包产物的 `app-update.yml` 中。
- “健康启动”目前定义为新版本进入主进程 `onAppReady`。如果应用在此之后、主窗口可用之前崩溃，不会自动回退。
- 差分更新减少的是网络流量。Inno 仍需在本地写入完整版本目录，因此小改动仍可能有约 20～30 秒的本地准备时间。
- 自动降级关闭。正式版本出现问题时应停止清单分发并发布更高版本的修复包，不能用同一版本号覆盖二进制。

## 3. 更新源拓扑

| 构建用途 | `VETTA_UPDATE_PROVIDER` | 更新源 | 建议地址 |
|---|---|---|---|
| 官方稳定版 | `generic` | R2 + Cloudflare CDN | `https://releases.openvetta.com/desktop/stable` |
| 本地闭环测试 | `generic` | R2 独立前缀 | `https://releases.openvetta.com/desktop/test` |
| 开源版本 | `github` | 公开 GitHub Releases | 仓库 Release |
| 开发/QA 无更新包 | `none` | 无 | 不生成 `app-update.yml` |

R2 推荐对象布局：

```text
desktop/
  stable/
    latest.yml
    Vetta-<version>-win-x64.exe
    Vetta-<version>-win-x64.exe.blockmap
  test/
    latest.yml
    Vetta-<version>-win-x64.exe
    Vetta-<version>-win-x64.exe.blockmap
```

`stable` 和 `test` 必须同时在客户端 URL、R2 前缀和 Cloudflare 路由上保持一致，不能只改其中一个。

## 4. Windows 文件布局

### 4.1 首次/手动安装目录

默认安装目录：

```text
%LOCALAPPDATA%\Programs\Vetta\
  Vetta.exe                         # Go 稳定启动器
  current.json                      # 安装包内置版本指针
  versions\<bundled-version>\       # 随安装包携带的 Electron 应用
    Vetta.exe
    resources\app.asar
```

桌面快捷方式、开始菜单、URL Protocol 和卸载项都指向根目录的稳定启动器，不直接指向某个版本的 Electron EXE。

### 4.2 后台更新目录

```text
%LOCALAPPDATA%\Vetta\
  current.json                      # 后台更新的活动版本指针
  versions\<version>\               # 后台准备的新版本
  installer\<version-pid-time>\     # Inno 临时进度与失败日志
```

活动指针示例：

```json
{
  "version": "0.5.56",
  "previousVersion": "0.5.55",
  "pending": false
}
```

`pending: true` 表示新版本已经激活但还没完成健康确认。稳定启动器发现 pending 时会优先回退 `previousVersion`；新版本进入 `onAppReady` 后把 pending 改为 false。

### 4.3 差分下载缓存

```text
%LOCALAPPDATA%\vetta-updater\
  installer.exe                     # 当前版本安装包基线
  current.blockmap                  # electron-updater 管理的基线 blockmap
```

首次/手动安装完成后，Inno 用硬链接把安装源 EXE 写成 `installer.exe`；硬链接失败时回退为复制。后台下载完成后，主进程也会在运行 Inno 前提升新的安装包为下一次差分基线。

这两个动作都不能删除。缺少当前安装包基线时，客户端即使拿到了 blockmap，也可能退化为接近全量下载。

## 5. 完整客户端流程

```text
应用 ready
  -> 标记当前版本健康并清理旧版本
  -> 检查 latest.yml
  -> 发现更高版本
  -> 20 秒后自动下载（也可手动触发）
  -> electron-updater 校验并差分重建完整 EXE
  -> 提升 EXE 为下一次差分基线
  -> Inno 静默展开到 %LOCALAPPDATA%\Vetta\versions\<new>
  -> 校验 Vetta.exe、resources/app.asar、.install-complete
  -> 状态变为 ready，提示更新并重启
  -> 写 current.json（pending=true）
  -> 直接启动新版本 EXE，退出旧版本
  -> 新版本 onAppReady
  -> current.json（pending=false）
  -> 只保留 current + previous
```

### 5.1 检查和自动重试

- 打包应用 ready 后自动检查一次。
- 发现更新后默认等待 20 秒开始静默下载。
- 自动下载失败后按 30 秒、120 秒、600 秒重试。
- 120 秒没有任何下载/安装进度会被判定为卡住并取消。
- 手动点击下载失败会进入 error 状态并显示“下载更新失败”；自动下载失败会回到 available，等待下一次重试。
- `allowDowngrade=false`，相同或更低版本不会被识别为更新。

### 5.2 进度区间

Windows 自定义流程把进度划分为：

| UI 进度 | 阶段 | 含义 |
|---|---|---|
| 0%～90% | 网络下载 | electron-updater 下载差异块并在本地重建完整 EXE |
| 91%～99% | 本地准备 | Inno 把完整应用写入新的版本目录 |
| 100% | 可重启 | 核心文件和 `.install-complete` 已验证 |

因此卡在 90% 或 95% 不一定是网络问题。90% 之后通常是在写入数千个本地文件；应结合主进程日志、Inno 进度文件和磁盘活动判断。

### 5.3 激活和回退

点击“更新并重启”不会再次运行安装程序。此时完整版本目录已经准备好，激活动作只做三件事：

1. 原子写入 `%LOCALAPPDATA%\Vetta\current.json`，记录新旧版本并设 `pending=true`。
2. 使用 `app.relaunch({ execPath: <new Vetta.exe> })` 启动新版本。
3. 退出旧版本。

如果新版本在健康确认前退出，用户下次从桌面快捷方式启动时，稳定启动器读取到 pending 并回退上一版本。

### 5.4 旧版本清理

- 新版本健康后只保留当前版本和 `previousVersion`。
- 更早的 `%LOCALAPPDATA%\Vetta\versions\*` 会被物理删除。
- 手动重新安装会删除后台活动指针，优先回到安装包内置版本；遗留的后台版本目录可能要到下一次成功更新后才被清理。
- 正常卸载会删除后台版本目录、安装临时目录和活动指针。
- `%LOCALAPPDATA%\vetta-updater` 当前不在 Inno 的卸载清理列表中，卸载后可能残留一个安装包缓存；这是已知清理边界。

## 6. 为什么使用 EXE，而不是 ZIP

Windows 发布 EXE 的原因：

- 用户首次安装、手动修复安装和自动更新只维护一种产物。
- Inno 能注册卸载项、快捷方式和 `vetta://` 协议。
- 后台模式可以使用同一 EXE 静默写入指定版本目录。
- electron-updater 可以对 EXE 生成外置 blockmap，并不要求必须使用 ZIP。
- 代码签名接入后也只需要签名同一个安装产物。

为了使 EXE 的差分块稳定，Inno 配置使用：

- `SolidCompression=no`：避免一个小文件变化使后续整个固实压缩流都改变。
- `resources/app.asar` 外层 `nocompression`：ASAR 本身已经是归档，不再套一层 LZMA2；可提高 blockmap 对未变化块的复用率。

不应同时向 Windows 更新清单提供 ZIP 和 EXE，否则会增加产物选择、缓存基线和验证复杂度。

## 7. 本地 R2 更新闭环测试

### 7.1 环境变量

本地敏感变量写在已忽略的 `packages/desktop-app/.env.development`，不要提交真实凭据：

```dotenv
VETTA_UPDATE_PROVIDER=generic
VETTA_UPDATE_URL=https://releases.openvetta.com/desktop/test
VETTA_R2_ACCOUNT_ID=<account-id>
VETTA_R2_ACCESS_KEY_ID=<access-key-id>
VETTA_R2_SECRET_ACCESS_KEY=<secret-access-key>
VETTA_R2_BUCKET=vetta-releases
VETTA_R2_PREFIX=desktop/test
```

构建脚本默认 `VETTA_BUILD_ENV=development`，因此会读取 `.env.development`；Shell 中显式设置的变量优先级更高。

R2 Token 只授予目标 Bucket 的对象读写权限。凭据只供发布脚本访问 R2 S3 API，不会写入桌面安装包；安装包只包含公开更新 URL。

### 7.2 构建一个更高的测试版本

测试版本可以通过环境变量覆盖，不修改 `package.json`，也不创建 Git tag：

```powershell
$env:VETTA_DESKTOP_BUILD_VERSION = "0.5.57"
bun run --cwd packages/desktop-app dist:win
```

必须满足：

- 测试版本严格高于客户端当前版本。
- 每个版本号只对应一份二进制，不能修改代码后重复上传相同版本号。
- QA 覆盖版本只能上传到 `test`。发布脚本拒绝把与 `package.json` 不一致的版本上传到 `stable`。

Windows 构建产物：

```text
packages/desktop-app/release/
  Vetta-0.5.57-win-x64.exe
  Vetta-0.5.57-win-x64.exe.blockmap
  Vetta-0.5.57-win-x64.exe.files.json
  latest.yml
```

`.files.json` 是本地安装完整性验证清单，不上传 R2。R2 客户端只需要 EXE、blockmap 和 `latest.yml`。

### 7.3 发布到 test

```powershell
bun run --cwd packages/desktop-app publish:updates:r2
```

这个命令先做 Inno 产物预检，再执行 R2 发布：

1. 在临时目录以后台模式运行刚构建的 Inno EXE。
2. 对照 `.files.json` 验证文件数量和每个文件大小。
3. 验证 `Vetta.exe`、`resources/app.asar` 和 `.install-complete`。
4. 解析 `latest*.yml`，只选择清单实际引用的产物。
5. 对大文件使用 16 MiB multipart、4 路并发上传。
6. 通过公开更新域名 HEAD 验证安装包和 blockmap。
7. 最后覆盖 `latest.yml`，再验证公开可读。

预检能在发布前发现安装器打不开、文件漏打包、版本目录不完整等问题，但不能代替真实升级测试。它不覆盖旧客户端缓存、Cloudflare Range/CDN、electron-updater 差分重建、活动指针切换和新进程启动；这些仍需要至少一轮已安装旧版本的端到端闭环。

发布脚本不会删除 R2 旧对象。版本化对象已存在时：

- 文件大小和对象 `sha512` 元数据一致：视为幂等发布，跳过上传。
- 内容不同或缺少元数据：拒绝覆盖。

如果 `release/` 内残留多个平台、不同版本的 `latest*.yml`，发布脚本会因清单版本不唯一而停止。发布前应确认所有清单属于同一版本。

### 7.4 客户端验证

1. 安装并启动一个更低版本的 test 构建。
2. 确认进程实际路径是该版本的 `Vetta.exe`。
3. 上传更高版本后，在旧客户端点击检查更新，或等待启动检查。
4. 观察网络阶段、Inno 本地准备阶段以及 ready 弹窗。
5. 点击更新并重启。
6. 验证进程路径、活动指针和版本目录。
7. 再次检查更新，确认 `currentVersion` 与 `latestVersion` 相同。

PowerShell 检查示例：

```powershell
Get-Content "$env:LOCALAPPDATA\Vetta\current.json"
Get-ChildItem "$env:LOCALAPPDATA\Vetta\versions"
Get-CimInstance Win32_Process -Filter "Name = 'Vetta.exe'" |
  Select-Object ProcessId, ExecutablePath
```

成功标准：

- `current.json.version` 是新版本且 `pending=false`。
- 运行进程来自 `%LOCALAPPDATA%\Vetta\versions\<new>\Vetta.exe`。
- 版本目录只保留新版本和上一版本。
- 主进程日志出现 `differential cache baseline promoted` 和 `downloaded Windows version is ready`。
- 下一次小版本更新的实际下载量显著小于完整 EXE。

## 8. Cloudflare/R2 配置要求

### 8.1 缓存

发布脚本写入的对象响应头：

| 文件 | Cache-Control |
|---|---|
| `latest*.yml` | `public, max-age=60, s-maxage=60, must-revalidate` |
| EXE、blockmap 等版本化产物 | `public, max-age=31536000, immutable` |

Cloudflare 缓存规则不要把 `latest.yml` 强制设为长期缓存。否则 R2 已更新但客户端仍会看到旧版本。版本化产物可以长期缓存，因为同一版本禁止覆盖。

CDN 命中可减少 R2 Class B 读取；回源未命中仍会产生 R2 操作。不要把“使用自定义域名”理解为所有请求在任何情况下都不计费。

### 8.2 Range 请求

差分下载要求自定义域名对 EXE 支持标准字节范围请求。应返回 `206 Partial Content` 和正确的 `Content-Range`。

```powershell
curl.exe -I "https://releases.openvetta.com/desktop/test/Vetta-<version>-win-x64.exe"
curl.exe -r 0-1023 -o NUL -D - "https://releases.openvetta.com/desktop/test/Vetta-<version>-win-x64.exe"
```

第二条响应应为 206。当前 `generic` provider 设置了 `useMultipleRangeRequest=false`，表示不用 multipart range，但仍会发普通单区间 Range 请求。

当前发布脚本只通过公开 URL 做 HEAD 存在性验证，不验证 206 行为。因此 Range 检查仍是首次配置域名和修改 Cloudflare 规则后的人工验收项。

### 8.3 Cloudflare 规则注意事项

- `latest*.yml` 短缓存，版本化产物长期 immutable。
- 不要对 EXE/blockmap 做会改变字节内容的转换。
- 不要启用会忽略 Range 或把 206 改成 200 的代理逻辑。
- 修改缓存规则后，用带查询参数和不带查询参数的 URL 都验证一次。
- R2 前缀与公开 URL path 必须完全相同，例如都为 `desktop/test`。

## 9. 正式发版与 GitHub Releases

### 9.1 R2 stable

正式版本以 `packages/desktop-app/package.json` 为版本真源，不使用 `VETTA_DESKTOP_BUILD_VERSION` 覆盖。配置：

```text
VETTA_UPDATE_PROVIDER=generic
VETTA_UPDATE_URL=https://releases.openvetta.com/desktop/stable
VETTA_R2_PREFIX=desktop/stable
```

必须先在 test 完成真实的“旧安装版 → CDN → 新版本 → 重启”闭环，再发布 stable。不要用 stable 通道迭代更新功能。

test 与 stable 是两个独立版本序列：`VETTA_DESKTOP_BUILD_VERSION` 只用于 test 客户端之间的版本比较，不决定正式版从哪个数字开始。正式版只要求高于 stable 通道已经发布的版本，并始终与 `packages/desktop-app/package.json` 一致。

### 9.2 GitHub Releases

开源包构建配置：

```text
VETTA_UPDATE_PROVIDER=github
VETTA_UPDATE_GITHUB_OWNER=<owner>
VETTA_UPDATE_GITHUB_REPO=<repository>
```

公开 Release 的客户端读取不需要 GitHub Token。桌面端使用标准 `v<version>` tag；tag 属于 desktop-app 发版，不应使用 coding-agent 专用 tag 语义。

`workflow_dispatch` 的工作流定义必须存在于 GitHub 默认分支，执行时可以选择其它分支。`push.tags: v*` 则由 tag 触发。

### 9.3 Action 发布边界

- `workflow_dispatch` 只构建、校验并保留三平台 Artifact，不上传 R2，也不创建 GitHub Release；因此可以在启用 CI 后用它做正式发布前演练。
- 只有 `v<packages/desktop-app/package.json version>` tag 才进入发布 Job。
- 其它同样使用标准 `v*` 命名的仓库 tag 只运行一个轻量 scope Job；版本不等于 desktop package 时直接跳过三平台构建，不消耗打包 runner。
- Windows Inno 完整安装校验在 Windows build Job 内完成；Linux 汇总发布 Job 不再尝试执行 Windows 安装器。
- macOS 凭据完全未配置时允许生成未签名包；只配置一部分时失败；凭据齐全时强制校验签名、公证和 Gatekeeper。
- R2/GitHub 发布共用 `desktop-production` environment 和串行并发组，避免两个任务同时覆盖发布状态。
- R2 上传前读取线上 `latest*.yml`，拒绝把任一平台清单降到更低版本。
- 已公开的 GitHub Release 不允许 CI 覆盖；失败任务只能继续上传仍处于 draft 的 Release。

Actions 可以在不发版时保持仓库级关闭。准备启用时，应先在 GitHub 默认分支放入当前工作流，再配置 `desktop-production` environment 的审核/分支策略；启用后先手动运行一次只构建演练，最后才创建正式 tag。

## 10. 历史问题、原因与修复

### 10.1 开发版启动时报 `Named export 'autoUpdater' not found`

**现象**

```text
Named export 'autoUpdater' not found. The requested module 'electron-updater' is a CommonJS module
```

**原因**：主进程产物是 ESM，`electron-updater` 被 externalize 后仍是 CommonJS。ESM 命名导入在 Electron 运行时失败。

**修复**：使用默认导入后解构：

```ts
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;
```

不要改回 `import { autoUpdater } from "electron-updater"`。

### 10.2 点击更新后再次出现完整安装向导

**原因**：早期流程把“下载完成”和“安装完成”混在一起，重启阶段仍执行普通安装器；普通模式会展示安装范围、下一步等向导。

**修复**：Inno 新增 `/VETTAUPDATE=true` 后台模式，下载阶段就静默准备新版本目录；重启阶段只切换指针。

### 10.3 没有向导，但重启仍很慢

**原因**：隐藏向导不等于消除安装工作。旧流程在用户点击重启后才解压/复制完整应用，视觉上像“重启卡住”。

**修复**：把 Inno 准备前移到下载阶段。ready 只在版本目录完整后出现，点击重启时不再运行安装器。

### 10.4 `Failed to uninstall old application files. Please try running the installer again.: 2`

**原因**：这是旧的“覆盖/卸载当前安装目录”模型与正在运行的文件、旧 NSIS/Inno 安装状态冲突的典型表现，不是 R2 下载问题。

**修复**：后台更新不再卸载或覆盖当前安装目录，而是写入 `%LOCALAPPDATA%\Vetta\versions\<new>`；后台 Inno 设置 `Uninstallable=no`、不创建卸载注册项。

如果手动执行修复安装仍遇到该提示，应完全退出 Vetta（包括托盘和子进程）后重试。不要把手动修复安装当作正常自动更新步骤。

### 10.5 下载停在 90% 或 95%

可能情况：

- 0%～90%：网络差分下载或本地重建完整 EXE。
- 91%～99%：Inno 正在写完整版本目录，文件多时进度变化慢。
- Inno 进程仍在运行但应用被用户关闭：后台安装器是 detached，可能继续完成目录准备，但活动指针尚未切换。
- 进度文件停止超过 120 秒：客户端会判定失败。
- 目标版本目录不完整：校验等待最多 30 秒后报错，并保留 Inno 日志。

不要仅凭百分比判断网络卡死。先查日志和进程，再决定是否重试。

### 10.6 显示“下载更新失败”，没有重启弹窗

ready 弹窗只会在以下三项同时存在后出现：

- `<version>\Vetta.exe`
- `<version>\resources\app.asar`
- `<version>\.install-complete`

常见原因：

- CDN/对象缺失，或 `latest.yml` 先于产物更新。
- EXE/blockmap 无法公开访问或 Range 行为异常。
- SHA-512 校验失败。
- Inno 返回非 0 exit code。
- 安装目标文件缺失，或 Electron ASAR 虚拟文件系统干扰真实文件校验。
- 用户中途退出、取消，或 120 秒无进度触发 stall timeout。

当前实现使用 `original-fs`/`process.noAsar` 对物理文件做校验，避免把 `app.asar` 误当成目录。Inno 失败时工作目录不会删除，可查看保留的 `install.log`。

### 10.7 点击“更新并重启”后没有反应

先区分三个阶段：

1. `%LOCALAPPDATA%\Vetta\current.json` 没有写成新版本：激活动作没有完成，检查主进程的 `install failed`。
2. 指针已更新但没有新版本进程：检查新版本 `Vetta.exe` 是否存在、启动日志和缺失模块错误。
3. 新版本进程存在但没有窗口：按下一节检查启动器的隐藏窗口问题。

如果用户在后台准备期间主动关闭应用，这是允许的边界情况。detached Inno 可能继续完成版本目录，但本次进程不会再弹 ready 对话框或写活动指针；重新启动旧版本并再次检查/下载时，客户端会复用已经完整的目标版本目录。

不要在看到旧窗口退出后立即重复运行安装器。先检查新进程路径和活动指针，避免手动安装与自动更新同时写目录。

### 10.8 更新后应用打不开或只有托盘，没有窗口

**原因**：稳定启动器曾使用 Windows `HideWindow` 启动 Electron。这会传递 `STARTF_USESHOWWINDOW + SW_HIDE`，导致 Electron 第一次显示主窗口也被系统压成隐藏。

**修复**：启动器自身用 GUI subsystem 避免控制台闪烁，但启动子 Electron 时不设置 `HideWindow`。不要重新引入该标志。

### 10.9 更新后缺少 `action-rpc` 或其它 workspace 模块

**原因**：主进程构建与打包 staging 的边界不一致。被 external 的运行时依赖或 workspace 导入没有进入最终 ASAR/extraResources，开发环境能运行，安装包运行时报模块不存在。

**当前保护**：

- `prepare-pack.js` 显式 staging `electron-updater`、`builder-util-runtime` 等 external 依赖及其生产依赖闭包。
- coding-agent runtime、agent-rpc CLI 和 cli-app 作为资源进入安装包。
- 打包前扫描 `dist/main`，若仍有 `@vetta/*` workspace import 会直接失败。
- R2 发布前 Inno 预检会把版本目录全部展开并按 manifest 校验文件数量与大小。

新增/调整 Vite external 时必须同步检查 `prepare-pack.js` 的 staging 列表，不能只让开发模式通过。

### 10.10 R2 上有新版本，但客户端检查不到

依次检查：

1. 新版本是否严格高于客户端版本。
2. 客户端安装包内 `app-update.yml` 是否指向 test，而不是 stable/GitHub。
3. `VETTA_UPDATE_URL` path 是否与 `VETTA_R2_PREFIX` 一致。
4. 公网 `latest.yml` 是否已经是新版本。
5. Cloudflare 是否缓存了旧 `latest.yml`。
6. `latest.yml` 引用的文件名、大小、SHA-512 是否对应当前 EXE。
7. 是否误用同一版本号重建产物；版本化对象禁止覆盖。

### 10.11 体感下载量没有减少

**根因**：手动安装的基线 EXE 没有进入 electron-updater 的缓存，或缓存里的 `installer.exe` 与 `current.blockmap` 不属于同一版本。此时有 blockmap 也无法从正确旧文件复用块。

**修复**：

- 普通 Inno 安装完成后调用 `SeedUpdaterDifferentialCache()`，优先硬链接安装源 EXE到缓存。
- 手动安装替换缓存时删除旧 `current.blockmap`，避免新 EXE 配旧 blockmap。
- 每次后台下载完成后，在运行 Inno 之前提升新 EXE 为下一次基线。
- 提升失败时清理临时文件、安装包缓存和 blockmap，避免留下错误配对。

日志中的 `To download: 741.68 KB (0%)` 不是零下载。741 KB 相对约 250 MB 不足 1%，electron-updater 取整后显示为 0%。

### 10.12 上传到了 stable，但仍在测试

测试链路必须同时使用：

```text
VETTA_UPDATE_URL=.../desktop/test
VETTA_R2_PREFIX=desktop/test
```

当前发布脚本会校验 URL path 与 R2 prefix，并拒绝把版本覆盖值上传到最后一段为 `stable` 的前缀。旧对象无需为每次测试手动删除；版本化文件保留有助于追溯，清理应使用独立生命周期策略。

## 11. 实测案例：0.5.55 → 0.5.56

本次用于确认差分缓存修复是否生效的结果：

| 指标 | 结果 |
|---|---:|
| 完整 EXE | 256,272.07 KB（约 250.3 MB） |
| 变化块 | 35 |
| 实际网络下载 | 741.68 KB（759,481 bytes） |
| 下载并重建完整 EXE | 约 6.96 秒 |
| Inno 本地准备 | 约 23.44 秒 |
| 下载 + 准备 | 约 30.4 秒 |

上一轮因缓存基线陈旧，实际下载约 89,369.47 KB、下载阶段约 40.4 秒。修复后网络下载量下降约 99.2%。

这个结果说明：

- blockmap、Range 请求和缓存基线都已实际工作。
- 剩余主要耗时是本地 Inno 写入完整版本目录，不是 R2/CDN 下载。
- 以后优化“重启快”不应再改下载协议；应针对本地文件准备，但必须保留完整性和回退能力。

## 12. 日志与诊断

### 12.1 应用日志

```text
~/.vetta/desktop-app/logs/main/YYYY-MM-DD.log
```

重点搜索：

```text
[updater]
differential download
File has ... changed blocks
Full: ..., To download: ...
differential cache baseline promoted
preparing Windows version with Inno Setup
downloaded Windows version is ready
download failed
install failed
```

不要记录 R2 Secret、Access Key、Authorization 或 Cookie。

### 12.2 Inno 失败日志

```text
%LOCALAPPDATA%\Vetta\installer\<version-pid-time>\install.log
```

成功时工作目录会异步删除；失败时刻意保留。重点检查：

- Inno exit code。
- 目标目录和写入失败的文件。
- 是否存在权限、占用、杀毒软件拦截或磁盘空间问题。
- 是否写入 `.install-complete`。

### 12.3 现场检查顺序

1. 记录客户端版本、`latest.yml` 版本和更新源 URL。
2. 记录 `current.json`，不要先手工修改。
3. 检查正在运行的 `Vetta.exe`/安装器路径。
4. 检查版本目录是否完整。
5. 查看主进程日志中最后一个 updater 阶段。
6. 如果 Inno 失败，保存对应 `install.log`。
7. 检查 `%LOCALAPPDATA%\vetta-updater\installer.exe` 的时间和大小。
8. 验证 CDN HEAD、Range 206 和 `latest.yml` 缓存。
9. 最后再决定重试、手动修复安装或发布更高修复版本。

不要在现场第一步就删除缓存、版本目录或 R2 对象；这会破坏问题证据，也可能让差分测试退化为全量下载。

## 13. 发布前检查清单

### 构建

- [ ] 版本号高于已发布版本。
- [ ] stable 使用 `package.json` 正式版本；test 才使用构建版本覆盖。
- [ ] 更新 provider/URL 写入目标包。
- [ ] EXE、blockmap、files manifest、`latest.yml` 属于同一版本。
- [ ] Inno 本地预检通过，文件数量和大小一致。
- [ ] 最终包不含未解析的 `@vetta/*` workspace import。

### R2/Cloudflare

- [ ] URL path 与 R2 prefix 一致。
- [ ] test/stable 没有混用。
- [ ] 安装包与 blockmap 可公开读取。
- [ ] EXE Range 请求返回 206。
- [ ] `latest.yml` 是短缓存，版本化产物是 immutable。
- [ ] 清单最后发布。

### 客户端闭环

- [ ] 旧安装版能检查到新版本。
- [ ] 差分日志显示变化块与实际下载量。
- [ ] 90% 后 Inno 准备能到 100%。
- [ ] ready 后重启不再显示安装向导。
- [ ] 新进程路径指向新版本目录。
- [ ] `current.json.pending=false`。
- [ ] 只保留当前和上一版本。
- [ ] 再发布一个极小改动版本，确认实际下载量没有退化。

### 正式发布

- [ ] test 已完成真实安装版闭环，不只做了构建产物预检。
- [ ] Windows 签名状态符合发布要求。
- [ ] workflow_dispatch 三平台只构建演练已通过，且没有改动 stable。
- [ ] `desktop-production` environment 的审核与允许分支已配置。
- [ ] macOS 当前是明确接受的未签名阶段，或签名/公证校验已经通过。
- [ ] 失败回滚策略、上一版本清单和诊断负责人已明确。

## 14. 关键实现文件

| 文件 | 职责 |
|---|---|
| `packages/desktop-app/src/main/updater.ts` | 初始化 electron-updater 和 Windows Inno controller；处理 CommonJS 导入边界 |
| `packages/desktop-app/src/main/updater-service.ts` | 更新状态机、自动下载、重试、stall timeout 和 UI 状态广播 |
| `packages/desktop-app/src/main/updater-engine.ts` | electron-updater 适配、进度映射、差分缓存基线提升 |
| `packages/desktop-app/src/main/inno-windows-update.ts` | Inno 后台安装、物理文件校验、激活指针、健康确认和旧版本清理 |
| `packages/desktop-app/native/windows-launcher/main.go` | 稳定入口、版本选择和 pending 回退 |
| `packages/desktop-app/build/installer.iss` | Inno 普通/后台模式、版本目录写入、进度文件和首次缓存播种 |
| `packages/desktop-app/scripts/windows-version-layout.mjs` | 把 electron-builder 目录转换为稳定启动器 + 版本目录布局 |
| `packages/desktop-app/scripts/build-inno-installer.mjs` | 构建 EXE、blockmap、files manifest 和 `latest.yml` |
| `packages/desktop-app/scripts/verify-inno-update.mjs` | 发布前临时安装与全文件预检 |
| `packages/desktop-app/scripts/publish-update-artifacts-r2.mjs` | R2 原子发布、缓存头、幂等校验和公开可读验证 |
| `packages/desktop-app/scripts/resolve-update-publish-config.mjs` | generic/GitHub/none 构建期 provider 配置 |
| `.github/workflows/desktop-release.yml` | 三平台构建及 R2/GitHub Release 发布编排 |

修改更新链路时，必须同步检查状态机、安装器、稳定启动器、构建产物、R2 发布和真实旧版升级六个层面；仅让其中一个层面的测试通过不足以证明更新可用。
