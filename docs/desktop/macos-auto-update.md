# macOS 自动更新、R2 发版与排障

本文是 Vetta Desktop macOS 更新链路的维护手册，与 [`windows-auto-update.md`](./windows-auto-update.md) 平行。两端共用同一套更新源配置、发布脚本、状态机和 CI 编排；差异集中在安装机制与产物形态，本文只展开 macOS 侧。

## 1. 当前结论

macOS 当前采用以下组合：

- `electron-updater` 的 `MacUpdater`：检查 `latest-mac.yml`、版本比较、SHA-512 校验、blockmap 差分下载和下载缓存。
- Squirrel.Mac（Electron 内置 `autoUpdater`）：解包暂存新版本、验签、重启时原地替换 `.app`。
- Developer ID 签名 + 公证：**不是可选项**，未签名的应用 Squirrel.Mac 直接拒绝工作。
- R2 + Cloudflare 自定义域名：官方版本的静态更新源。
- GitHub Releases：开源版本可选更新源。

更新源是**构建期配置**，与 Windows 完全一致，写在打包产物的 `app-update.yml` 里。

macOS 需要发布两种产物：**ZIP 供自动更新**（Squirrel.Mac 只认 ZIP），**DMG 供首次安装**。两者都进 `latest-mac.yml`，客户端按扩展名各取所需。

## 2. 设计目标与边界

### 2.1 已实现

- 与 Windows 共用同一套更新状态机、进度语义和发布脚本。
- arm64 与 x64 双架构，`latest-mac.yml` 单一清单同时描述两套产物。
- 强制签名 + 公证，并在发布前逐项校验签名、Gatekeeper 接受状态和公证票据。
- 下载与暂存分离：只有 Squirrel.Mac 真正完成暂存后才提示重启。
- 使用 blockmap 与本地 ZIP 基线做差分下载。
- 发布新清单前先上传并公开验证其引用的产物。

### 2.2 当前边界

- **没有失败回退**。Windows 有版本目录 + `pending` 指针，新版本启动失败可回退上一版；Squirrel.Mac 是原地替换，装坏了只能重装。
- **暂存阶段没有进度**。Squirrel.Mac 不上报解包与验签进度，UI 停在 90%（见 5.2）。
- **未签名包完全不可更新**。开发或 `workflow_dispatch` 出的未签名测试包只能用于验证构建链路，不能验证更新。
- 新旧版本必须使用**同一个 Developer ID 身份和一致的 bundle identifier**，换证书等于断开更新链。
- 自动降级关闭（`allowDowngrade=false`），同版本或更低版本不会被识别为更新。
- 出问题只能停止分发清单并发布更高版本，不能用同一版本号覆盖二进制。

## 3. 更新源拓扑

与 Windows 共用，见 `windows-auto-update.md` 第 3 节。R2 对象布局中 macOS 部分：

```text
desktop/
  stable/
    latest-mac.yml
    Vetta-<version>-mac.zip              # x64 更新包
    Vetta-<version>-mac.zip.blockmap
    Vetta-<version>.dmg                  # x64 首装包
    Vetta-<version>-arm64-mac.zip        # arm64 更新包
    Vetta-<version>-arm64-mac.zip.blockmap
    Vetta-<version>-arm64.dmg            # arm64 首装包
```

`latest.yml`（Windows）与 `latest-mac.yml`（macOS）是同一前缀下两份独立清单，互不影响，两个平台可以独立发版。

## 4. 双架构与元数据合并

内置的 node / python 运行时按 `VETTA_VENDOR_PLATFORM` **单架构落盘**，一次 electron-builder 调用出不了两套正确产物，因此 arm64 与 x64 必须分两次构建：

```json
"dist:mac:arm64": "cross-env VETTA_VENDOR_PLATFORM=darwin-arm64 VETTA_CLI_TARGET_PLATFORMS=darwin-arm64 ... --arch arm64"
"dist:mac:x64":   "cross-env VETTA_VENDOR_PLATFORM=darwin-x64   VETTA_CLI_TARGET_PLATFORMS=darwin-x64   ... --arch x64"
```

而 electron-builder 两次都写同名的 `latest-mac.yml`（`getUpdateInfoFileName` 只给 Linux 加架构后缀），多架构合并只发生在**单个进程的内存里**，分两次构建时后一次会直接覆盖前一次。

因此约定：两次构建各自把 `latest-mac.yml` 改名为 `latest-mac-<arch>.yml`，发布前用 `bun run merge:updates:mac`（`scripts/merge-mac-update-metadata.mjs`）合并：

- 校验两份清单版本一致，不一致直接失败。
- `files` 取并集（按 url 去重），排序为「ZIP 在前、x64 在 arm64 之前」，与 electron-builder 单次多架构构建的产物顺序一致。
- 顶层 `path` / `sha512` 指向排序后的第一个产物（x64 ZIP），供旧版 electron-updater 回退使用。
- 合并完成后删除 `latest-mac-<arch>.yml`。

**漏掉合并的后果**：`MacUpdater.filterFilesForArch` 在 x64 机器上会过滤掉所有含 `arm64` 的文件，清单里只剩 arm64 条目时抛 `ERR_UPDATER_ZIP_FILE_NOT_FOUND`；反之 arm64 机器优先选 arm64，清单里只有 x64 时会退而下载 x64 包，用户静默拿到 Rosetta 版本。

## 5. 完整客户端流程

```text
应用 ready
  -> 检查 latest-mac.yml
  -> 按当前架构（含 Rosetta 检测）挑选 ZIP
  -> 发现更高版本
  -> 20 秒后自动下载（也可手动触发）
  -> electron-updater 差分下载并校验 SHA-512        [0% ~ 90%]
  -> 起本地代理服务器，把 ZIP 喂给 Squirrel.Mac
  -> Squirrel.Mac 解包、验签、暂存                  [停在 90%]
  -> 收到原生 update-downloaded 事件
  -> 状态变为 ready，提示更新并重启                 [100%]
  -> quitAndInstall：Squirrel 原地替换 .app 并重启
```

### 5.1 检查和自动重试

与 Windows 完全一致（`updater-service.ts` 是平台无关的）：

- 打包应用 ready 后自动检查一次。
- 发现更新后默认等待 20 秒开始静默下载。
- 自动下载失败后按 30 秒、120 秒、600 秒重试。
- 手动下载失败进入 error 状态；自动下载失败回到 available 等待下一次重试。

### 5.2 进度区间

| UI 进度 | 阶段 | 含义 |
|---|---|---|
| 0%～90% | 网络下载 | electron-updater 差分下载并校验 ZIP |
| 90%（不动） | 本地准备 | Squirrel.Mac 解包、验签、暂存 |
| 100% | 可重启 | 收到原生 `update-downloaded` |

与 Windows 的 `0～90 网络 / 91～99 本地 / 100 就绪` 语义对齐：**90% 之后是本地准备，不是网络问题**。区别在于 Squirrel.Mac 不上报暂存进度，所以 macOS 在这一段是静止的 90%，而不是 91～99 缓慢爬升。

### 5.3 两种超时

| 阶段 | 超时 | 触发后 |
|---|---|---|
| 网络下载 | 120 秒无进度事件 | 取消下载，报「下载更新失败」 |
| 本地准备 | 600 秒 | 同上 |

暂存阶段不产生任何进度事件，沿用 120 秒的停滞超时会把它误判为卡死（见 10.1）。`UpdateEngine.downloadUpdate` 的 `onStaging` 回调就是用来切换这两个超时的。

需要说明这个窗口实际有多长：Squirrel.Mac 的 `update-downloaded` 只表示「ZIP 已收进 ShipIt 暂存区」，**真正的解包与代码签名校验发生在应用退出之后、由 ShipIt 助手完成**，不在这个窗口内。实测 M4 上只有 3.4 秒（见第 12 节）。所以 120 秒并非「必然」超时，但这段时长不受我们控制（取决于磁盘与包体积），且零进度事件，仍应使用独立的长兜底而不是停滞超时。

### 5.4 差分下载基线

差分需要三样东西同时具备：

| 需要 | 从哪来 |
|---|---|
| 新版 blockmap | 随产物发布，`<zip>.blockmap` |
| **旧版** blockmap | 把新版 URL 里的版本号替换成旧版号推出来（`Provider.getBlockMapFiles`），因此**旧版本的 blockmap 不能从 R2 删掉** |
| 本地基线 `update.zip` | electron-updater 每次下载完成后复制一份 |

缓存目录由 `app-update.yml` 的 `updaterCacheDirName` 决定，当前是 `vetta-updater`，与 Windows 的 `%LOCALAPPDATA%\vetta-updater\` 同名：

```text
~/Library/Caches/vetta-updater/
  update.zip                                  # 差分基线
  pending/                                    # 下载中的新版本
~/Library/Caches/com.vetta.desktop.ShipIt/    # Squirrel 暂存区
```

**从 DMG 安装后的第一次更新必定是全量下载**，日志会打 `Unable to locate previous update.zip for differential download (is this first install?)`。因为 `MacUpdater` 只在 electron-updater 完成一次下载后才写 `update.zip`，而 DMG 安装不经过它。Windows 靠 Inno 安装器的 `SeedUpdaterDifferentialCache()` 播种基线，macOS 没有等价物，也做不出来——基线必须与线上 ZIP 逐字节一致，无法从已安装的 `.app` 反推。第二次更新起才走差分。

测试时可以手工播种，跳过那一轮全量（ZIP 必须正是当前已安装版本的那一份）：

```bash
mkdir -p ~/Library/Caches/vetta-updater
cp release/Vetta-<installed-version>-arm64-mac.zip ~/Library/Caches/vetta-updater/update.zip
# 核对与线上清单一致
shasum -a 512 -b ~/Library/Caches/vetta-updater/update.zip | awk '{print $1}' | xxd -r -p | base64
```

反过来要复现全量下载，删掉 `update.zip` 即可。

**不要拿 Windows 的差分效果做基准。** Windows 实测 250MB 只下 741KB（见 `windows-auto-update.md` 第 11 节），macOS 达不到：公证要求每个 Mach-O 带 Apple 安全时间戳，每次构建重新签名都会拿到新的时间戳，于是所有二进制的签名段都变。好在签名追加在 `LC_CODE_SIGNATURE`、代码页哈希不变，ZIP 又是逐条目 deflate，所以变的是每个二进制的尾部而非整体。

## 6. 为什么 ZIP 和 DMG 都要发

- **ZIP 是 Squirrel.Mac 的唯一输入**。`MacUpdater.doDownloadUpdate` 里 `findFile(files, "zip", ["pkg", "dmg"])` 明确排除 DMG，没有 ZIP 直接抛 `ERR_UPDATER_ZIP_FILE_NOT_FOUND`。
- **DMG 是给人下载的**。带背景图和 `/Applications` 快捷方式，是官网下载页的产物。
- 两者由同一次 electron-builder 调用产出，签名与公证票据完全相同，不存在版本漂移。

ZIP 必须有配套 `.blockmap`，否则差分下载退化为全量。`verify-mac-update.mjs` 会强制检查这一点。

## 7. 本地 R2 更新闭环测试

### 7.0 一键脚本

日常发版用 `scripts/release-mac.sh`，它把 7.1～7.5 的所有步骤串起来，并在开跑前做完全部前置校验（避免构建到第 40 分钟才发现配置错）：

```bash
scripts/release-mac.sh local --version 0.5.62     # 本地闭环，跳公证、不碰 R2
scripts/release-mac.sh test  --version 0.5.60     # QA 通道
scripts/release-mac.sh stable                     # 正式通道，版本取 package.json
scripts/release-mac.sh test  --version 0.5.60 --arch both       # 双架构 + 自动合并
scripts/release-mac.sh test  --version 0.5.60 --check-only      # 只跑前置校验就退出
scripts/release-mac.sh test  --version 0.5.60 --skip-publish    # 构建与校验，不上传
```

`--check-only` 之外的任何调用都会先 `rm -rf release/` 再构建，别拿真实版本号试探参数。

脚本会自动 `source` 两个凭据文件，并直接注入构建期的 `VETTA_UPDATE_PROVIDER` / `VETTA_UPDATE_URL`，**因此不依赖 `.env.development` 里有没有配这两项**。

前置校验包括：凭据文件存在且字段完整、钥匙串里有可用签名身份、`VETTA_R2_PREFIX` 与 `VETTA_UPDATE_URL` 的末段都等于目标通道、版本号格式合法、**版本严格高于该通道线上已有版本**（同名版本化对象禁止覆盖）。`stable` 额外拒绝 `--version`（正式版本以 `package.json` 为唯一真源）并要求输入版本号二次确认。

下面各节是这个脚本每一步在做什么，手动排查时按需单独执行。

### 7.0.1 local 通道：不走 Apple、不碰 R2 的快速闭环

验证更新链路本身（暂存、重启、差分）时，每轮等 10～30 分钟公证是纯浪费。`local` 通道**保留签名但跳过公证**：

- Squirrel.Mac 只校验代码签名，不要求公证票据；
- 本地构建的产物没有 quarantine 属性，Gatekeeper 不会拦；
- 因此这条链路测出来的行为与正式包一致，唯独产物**不可分发**（用户下载到的包带 quarantine，没票据会被判「已损坏」）。

安全网：`test` / `stable` 的发布门禁会跑 `xcrun stapler validate`，未公证的产物过不去，不会误发。

```bash
# 1. 基线版本
scripts/release-mac.sh local --version 0.5.62
# 装 release/ 里的 DMG 到 /Applications

# 2. 起分发服务（另开终端，保持运行）
bun run --cwd packages/desktop-app serve:updates:local

# 3. 播种差分基线（第一次需要，之后 electron-updater 会自动维护）
cp packages/desktop-app/release/Vetta-0.5.62-arm64-mac.zip ~/Library/Caches/vetta-updater/update.zip

# 4. 改点东西，出下一版
scripts/release-mac.sh local --version 0.5.63

# 5. 从终端启动 0.5.62 验证
/Applications/Vetta.app/Contents/MacOS/Vetta
```

两个细节决定这个通道能不能测差分：

- **产物累积不清空**。`~/.vetta/local-updates` 只覆盖 `latest-mac.yml`，旧版本的 zip 与 blockmap 全部保留——差分要读旧版 blockmap（见 5.4）。
- **分发服务必须支持 Range**。`scripts/serve-local-updates.mjs` 自己实现了 206；不要随手换成 `python3 -m http.server`，它会无视 Range 头返回 200 全量，差分要么退化要么失败，测出来的结论是假的。

想临时压缩签名耗时，可以再叠 `VETTA_SKIP_VENDOR=1`——更新链路不依赖内置 node/python，而它们解压后是几千个待签名的 Mach-O。

### 7.1 前提：签名凭据

macOS 的本地闭环**必须有 Developer ID 证书**，未签名包走不到暂存阶段（原生 `autoUpdater` 报 `Could not get code signature for running application`）。

```bash
source ~/.config/vetta/mac-signing.env
security find-identity -v -p codesigning        # 期望 1 valid identity
```

凭据变量的含义与申请流程见 [`../deploy/apple-code-signing.md`](../deploy/apple-code-signing.md)。

### 7.2 环境变量

与 Windows 同构，注意同一个坑：**构建期变量走 `.env.development`，发布期变量必须 export 到 Shell**（原因见 `windows-auto-update.md` §7.1）。

```dotenv
# packages/desktop-app/.env.development
VETTA_UPDATE_PROVIDER=generic
VETTA_UPDATE_URL=https://releases.openvetta.com/desktop/test
```

```bash
export VETTA_R2_ACCOUNT_ID=<account-id>
export VETTA_R2_ACCESS_KEY_ID=<access-key-id>
export VETTA_R2_SECRET_ACCESS_KEY=<secret-access-key>
export VETTA_R2_BUCKET=vetta-releases
export VETTA_R2_PREFIX=desktop/test
export VETTA_UPDATE_URL=https://releases.openvetta.com/desktop/test
export VETTA_REQUIRE_MAC_SIGNATURE=1
```

### 7.3 构建测试版本

与 Windows 一样用 `VETTA_DESKTOP_BUILD_VERSION` 覆盖版本号，不改 `package.json`、不打 tag：

```bash
cd packages/desktop-app
rm -rf release                                  # 残留清单会让发布脚本判定版本不唯一
VETTA_DESKTOP_BUILD_VERSION=0.5.60 bun run dist:mac:arm64
VETTA_REQUIRE_MAC_SIGNATURE=1 bun run verify:updates:mac
```

只测本机架构时到此为止。要同时发双架构，复现 CI 的重命名与合并：

```bash
mv release/latest-mac.yml release/latest-mac-arm64.yml
VETTA_DESKTOP_BUILD_VERSION=0.5.60 bun run dist:mac:x64
VETTA_REQUIRE_MAC_SIGNATURE=1 bun run verify:updates:mac
mv release/latest-mac.yml release/latest-mac-x64.yml
bun run merge:updates:mac
```

在 arm64 机器上交叉构建 x64 包可以完成，但**无法在本机验证其可运行性**（`uiohook-napi`、`electron-liquid-glass` 的 x64 prebuild 是否齐全只有 Intel 机器能确认）。

签名 + 公证会让构建明显变慢：产物内置 node / python 运行时与多个 sidecar 二进制，逐个签名再上传公证，整体多出 10～30 分钟属正常。

### 7.4 `verify:updates:mac` 检查什么

`scripts/verify-mac-update.mjs`：

1. `latest-mac.yml` 版本格式与 `files` 非空。
2. 每个产物存在，且大小与 SHA-512 与清单一致。
3. 顶层 `path` / `sha512` 与对应产物一致。
4. 每个 ZIP 都有非空 `.blockmap`。
5. `VETTA_REQUIRE_MAC_SIGNATURE=1` 时，用 `ditto` 解包每个 ZIP，校验：
   - 顶层有且只有一个 `.app`
   - `CFBundleShortVersionString` 与清单版本一致
   - `CFBundleIdentifier` 是 `com.vetta.desktop`
   - `codesign --verify --deep --strict`
   - `spctl -a -t exec`（Gatekeeper 接受）
   - `xcrun stapler validate`（公证票据已钉入）

这是构建产物预检，**不能代替真实升级测试**：不覆盖旧客户端缓存、CDN Range 行为、差分重建、Squirrel 暂存和重启。

### 7.5 发布到 test

```bash
bun run publish:updates:r2
```

先跑 `verify-update-artifacts.mjs`（按平台分派，非 Windows 上跳过 Inno 运行时验证），再执行 R2 发布：先传产物（`immutable`，一年缓存）→ 公网 HEAD 确认 → 最后传 `latest-mac.yml`（60 秒缓存）→ 再确认。

版本化对象已存在时：大小与 `sha512` 元数据一致视为幂等发布跳过；内容不同则拒绝覆盖。**改了代码必须换版本号。**

### 7.6 客户端验证

1. 安装一个更低版本的 test 构建到 `/Applications`（必须是 `/Applications`，Squirrel 需要能写 app bundle 所在目录）。
2. 从终端启动以便看日志：`/Applications/Vetta.app/Contents/MacOS/Vetta`
3. 上传更高版本后，等待启动检查或手动点检查更新。
4. 观察三行日志的时间间隔：

```text
[updater] waiting for Squirrel.Mac to stage the update
（进度到 90%，这一段是解包与验签）
[updater] Squirrel.Mac update is ready to install
```

5. 点击更新并重启。
6. 确认版本号、内置 node / python runtime 都来自新版本。
7. 再次检查更新，确认 `currentVersion` 与 `latestVersion` 相同。

成功标准：

- 90% 之后能自行走到 ready，没有触发 600 秒兜底。
- 重启后没有任何「已损坏」「无法验证开发者」弹窗。
- 下一次小版本更新的实际下载量显著小于完整 ZIP。

## 8. Cloudflare/R2 配置要求

与 Windows 完全共用，见 `windows-auto-update.md` 第 8 节。macOS 侧的额外注意：

- 差分下载对 ZIP 同样依赖 Range 请求返回 206。
- `latest-mac.yml` 与 `latest.yml` 一样必须是短缓存。

## 9. 正式发版

正式发版由 tag 触发 `.github/workflows/desktop-release.yml`，三平台一次出全，与 Windows 共用同一条编排。macOS 的特殊之处是 **runner 是自持的**。

### 9.1 为什么用自持 runner

仓库是私有的，GitHub 托管 macOS runner 按 **10 倍**扣 Actions 分钟数。签名 + 公证的构建本就慢，再乘以两个架构，两次构建足以吃光 Free 计划每月 2,000 分钟的额度。自持 runner 不计分钟。

Windows 与 Linux 仍走托管 runner（倍率 2 与 1），额度充裕。

### 9.2 runner 准备

在签名机上注册，标签必须包含 `vetta-mac`：

```bash
./config.sh --url https://github.com/openvetta/vetta-mono --token <token> --labels vetta-mac
```

签名凭据放 runner 目录的 `.env`（`chmod 600`，不进版本控制）：

```dotenv
CSC_LINK=/Users/<you>/secrets/developer-id.p12
CSC_KEY_PASSWORD=<导出 p12 时的密码>
APPLE_TEAM_ID=<10 位>
APPLE_API_KEY=/Users/<you>/secrets/AuthKey_XXXXXXXXXX.p8
APPLE_API_KEY_ID=XXXXXXXXXX
APPLE_API_ISSUER=<uuid>
```

**必须用 `CSC_LINK`（`.p12` 路径）而不是 `CSC_NAME`**：走 `.p12` 时 electron-builder 会建临时钥匙串导入证书，绕开登录钥匙串；用 `CSC_NAME` 要读登录钥匙串，runner 作为后台服务运行时它是锁着的，报 `The specified item could not be found in the keychain` 或 `User interaction is not allowed`。

工作流的签名步骤会优先使用 runner 环境提供的凭据；只有在 runner 没提供时才回退到 CI Secret（`MACOS_CERTIFICATE_P12_BASE64` 等六项）。两者都没有时，tag 发版直接失败，`workflow_dispatch` 允许产出未签名测试包。

### 9.3 CI 上的 macOS 流程

```text
tag v<version>
  -> 校验 tag 名与 packages/desktop-app/package.json 版本一致
  -> 读取签名凭据，打开 VETTA_REQUIRE_MAC_SIGNATURE=1
  -> 清理上一轮的 release/（自持 runner 复用工作目录）
  -> dist:mac:<arch>
  -> verify:updates:mac
  -> latest-mac.yml 改名为 latest-mac-<arch>.yml
  -> 上传 artifact
（arm64 与 x64 两个 job 在同一台 runner 上串行）
  -> 四个平台 job 全绿后 publish-r2
  -> merge:updates:mac 合并元数据
  -> 发布到 desktop/stable
```

单个 runner 同时只跑一个 job，两个 macOS job 串行，墙钟时间约为单架构的两倍。需要并行可在同一台机器注册第二个 runner 实例（另建目录、同样打 `vetta-mac` 标签）。

必须先在 `test` 通道完成真实的「旧安装版 → CDN → 新版本 → 重启」闭环，再发布 stable。

## 10. 历史问题、原因与修复

### 10.1 下载到 100% 后报「下载更新失败」，但应用其实已经装好

**现象**：进度走完，界面报下载失败；此后无论怎么重试都停在 error，但重启应用会发现版本其实已经更新。

**原因**：`MacUpdater` 在把 ZIP 通过本地代理喂完给 Squirrel 的那一刻就 resolve（`response.on("finish")`），之后的解包与验签不再产生任何 `download-progress` 事件。而 `UpdaterService` 的 120 秒停滞超时只由进度事件重置，慢机器上必然超时：取消下载并置为 error；之后 Squirrel 暂存成功、promise 回来时又因 `activeDownload` 不匹配被丢弃，状态永久停在失败。

**修复**：`UpdateEngine.downloadUpdate` 新增 `onStaging` 回调标记进入安装准备阶段，该阶段改用 600 秒兜底超时。同时把网络阶段压缩到 0～90%，与 Windows 的进度语义对齐。

### 10.2 点「立即重启」后应用不退出，手动重启还是旧版本

**现象**：Dock 图标还在，窗口只是隐藏了；手动杀掉重开仍是旧版本。日志形如：

```
[updater] Squirrel.Mac update is ready to install
[window] close
[updater] Proxy server for native Squirrel.Mac is closed
[window] hide          ← 关键：窗口被隐藏而不是销毁
```

**原因**：Squirrel.Mac 走 `NSApp terminate:` 语义——系统逐个询问窗口能否关闭，**任何一个 `preventDefault()` 都会取消整个终止流程**。而 `main.ts` 的窗口 `close` 守卫在 macOS 上默认把关闭改成隐藏（平台惯例），只有 `app.isQuitting` 为真才放行。更新器这条路当时没有设这个标记，于是终止被取消，ShipIt 永远等不到进程退出，也就永远不做替换。

**修复**：`ElectronUpdaterEngine.quitAndInstall()` 在交给 Squirrel / Inno 之前先调用注入的 `prepareQuit()`，由 `updater.ts` 置 `app.isQuitting = true`——与托盘「退出」菜单用的是同一个标记。

**排查提示**：日志里 `close` 之后如果跟着 `hide`，就是被守卫拦了；正常应该是 `closed` 并且进程随即结束。

### 10.2.1 排查安装阶段的三个权威信息源

「点了重启但版本没变」有好几种成因，症状几乎一样，靠应用日志分不出来。按这个顺序查，五分钟能定位：

**① launchd 作业状态**——最有信息量的一个：

```bash
launchctl print "gui/$(id -u)/com.vetta.desktop.ShipIt"
```

| 看到什么 | 含义 |
|---|---|
| 报错「Could not find service」 | Squirrel 还没提交作业。应用退得太早（交棒后立刻 `app.exit(0)` 实测只需 41ms）。 |
| `runs = 0` + `port = 0x0` + `active = 0` | 作业提交了但从没被启动。它是按需 mach service，需要有人连上去或 `launchctl kickstart`。 |
| `runs = 1` + `last exit code = 0` | ShipIt 跑过了，去看它的日志。 |
| `state = running` 但版本没变 | ShipIt 在等目标进程退出——检查是不是还有 Vetta 进程活着。 |

**② ShipIt 自己的日志**——Squirrel 只在作业真正 spawn 后才创建这两个文件，**文件不存在本身就是结论**：

```bash
cat ~/Library/Caches/com.vetta.desktop.ShipIt/ShipIt_stderr.log
```

成功的样子：

```text
Detected this as an install request
Beginning installation
Moved bundle contents from ... to file:///Applications/Vetta.app/
Installation completed successfully
Successfully launched application at file:///Applications/Vetta.app/
```

**③ 待安装状态**（安装完成后会被清掉）：

```bash
plutil -p ~/Library/Caches/com.vetta.desktop.ShipIt/ShipItState.plist
```

`updateBundleURL` 指向暂存的新 bundle，可以直接读它的 `Info.plist` 确认暂存的是哪个版本；`launchAfterInstallation` 决定装完是否自动拉起。

**手动推进一次卡住的安装**（也是验证「问题只出在没人启动作业」的最快方式）：

```bash
launchctl kickstart "gui/$(id -u)/com.vetta.desktop.ShipIt"
pkill -f "Vetta.app/Contents/MacOS/Vetta"   # ShipIt 必须等目标退出才替换
```

**别用应用窗口判断应用是否还在跑。** 单实例锁会让新启动的实例退出并把老进程的窗口调出来，看着像「重启了但版本没变」，实际是同一个老进程。用 `pgrep -f "Vetta.app/Contents/MacOS/Vetta"` 看 pid，并和 `launchctl print` 里的 `submitted by Vetta[pid]` 对照。

### 10.3 提示重启过早出现（暂存尚未完成）

**原因**：早期实现在 `MacUpdater` resolve 时就置 ready，此时 Squirrel 还没暂存完，`quitAndInstall` 走的是 `squirrelDownloadedUpdate === false` 的分支——只注册监听器等待，不会立刻退出。

**修复**：监听原生 `autoUpdater` 的 `update-downloaded` 事件，只有它触发后才置 ready，`quitAndInstall` 因此总是走确定的 `handleUpdateDownloaded()` 分支。

### 10.4 Intel Mac 报 `ERR_UPDATER_ZIP_FILE_NOT_FOUND`

**原因**：只构建了 arm64，`MacUpdater.filterFilesForArch` 在 x64 机器上排除所有含 `arm64` 的文件，清单里没有可用 ZIP。

**修复**：拆成 `dist:mac:arm64` / `dist:mac:x64` 两个构建，元数据合并后同时包含两套。见第 4 节。

### 10.5 用户报「已损坏」

- 先确认下载的是**新版本**——已发布的旧 DMG 不会追溯获得公证票据。
- 让用户跑 `xattr -l /Applications/Vetta.app`，若只有 `com.apple.quarantine` 而 app 是公证过的，通常是下载过程被网络中间设备改写导致签名失效，换直链或换网络重下。
- 其余排查见 `../deploy/apple-code-signing.md` 第 6 节。

### 10.6 公证报 vendor 运行时未签名

**现象**：`notarytool` 返回 `Invalid`，issues 里全是这种路径：

```
Vetta.app/Contents/Resources/vendor/python/cpython-...tar.gz/cpython-...tar/python/bin/python3.13
  The binary is not signed with a valid Developer ID certificate.
  The signature does not include a secure timestamp.
  The executable does not have the hardened runtime enabled.
```

注意 `.tar.gz/` 后面还有路径——**Apple 的公证服务会解开归档递归校验里面的 Mach-O**。

**原因**：内置运行时曾统一以原始 `tar.gz` 形态打包（为了避免 Inno 每次重建数千个不变小文件）。electron-builder 只签得到文件系统上可见的二进制，签不进归档内部，于是 `python3.13`、`libpython3.13.dylib`、`libtcl9.0.dylib` 和一堆 `.so` 全部裸奔。

**修复**：`prepare-pack.js` 按目标平台分支——darwin 内置**解压目录**，Windows / Linux 保留归档。解压后 osx-sign 会像处理 `im-gateway`、`cli-app` 那样逐个签名（可用 `codesign -dvv` 验证它们带 `flags=0x10000(runtime)`）。`RuntimeManager.seedFromVendor` 相应地优先使用解压目录，找不到才回退归档解压。

代价是 macOS 的 `.app` 体积增大，Squirrel 暂存也更慢——5.3 的 600 秒兜底超时正是为此留的余量。

**注意**：从解压目录 seed 时必须用 `cp(..., { verbatimSymlinks: true })`。Node 的 `fs.cp` 默认会把相对符号链接（`python3 -> python3.13`）重写成指向源目录的绝对路径，安装后就指回了 app bundle 内部，更新替换 `.app` 时整片悬空。

### 10.7 公证返回 Invalid（其它嵌套二进制）

产物里有没签到的嵌套 Mach-O 二进制。`Contents/Resources/` 下带了 `im-gateway`、`cli-app`、`vendor/node`、`vendor/python`、`appshot` 等一堆可执行文件，用 `xcrun notarytool log <submissionId>` 看具体路径。排查时可先 `VETTA_SKIP_VENDOR=1` 摘掉内置运行时缩小范围。

## 11. 日志与诊断

### 11.1 应用日志

```text
~/.vetta/desktop-app/logs/main/YYYY-MM-DD.log
```

重点搜索：

```text
[updater]
waiting for Squirrel.Mac to stage the update
Squirrel.Mac update is ready to install
differential download
Full: ..., To download: ...
download failed
install failed
```

打包应用的 stdout 只有从终端启动才看得到：`/Applications/Vetta.app/Contents/MacOS/Vetta`。

不要记录 R2 Secret、Access Key、Authorization 或 Cookie。

### 11.2 现场检查顺序

1. 记录客户端版本、`latest-mac.yml` 版本和更新源 URL。
2. 记录客户端架构（`uname -m`）与是否 Rosetta（`sysctl sysctl.proc_translated`）。
3. 查主进程日志中最后一个 updater 阶段——尤其是有没有出现 `waiting for Squirrel.Mac to stage`。
4. 检查 `.app` 的签名与票据：`codesign -dv --verbose=4`、`spctl -a -vvv -t exec`、`xcrun stapler validate`。
5. 验证 CDN HEAD、Range 206 和 `latest-mac.yml` 缓存。
6. 最后再决定重试或发布更高修复版本。

不要在第一步就删缓存或 R2 对象，这会破坏证据，也会让差分测试退化为全量下载。

## 12. 实测案例：0.5.60 → 0.5.61（test 通道，arm64）

改动内容只有两个 i18n 字符串，用于确认差分链路是否真的工作：

| 指标 | 结果 |
|---|---:|
| 完整 ZIP | 242,717.53 KB（约 237.0 MB） |
| 变化块 | 3297 |
| 实际网络下载 | 69,712.68 KB（29%） |
| Range 请求数 | 225 |
| 差分下载耗时 | 约 48 秒 |
| Squirrel.Mac 暂存 | 约 3.4 秒 |

对照 Windows 同类测试（`windows-auto-update.md` 第 11 节）：250.3 MB 只下 741.68 KB、35 个变化块。

**差距不是配置问题，是 macOS 签名的固有代价。** 本次源码改动只有两个 JSON 字符串，却产生 3297 个变化块——公证要求每个 Mach-O 带 Apple 安全时间戳，每次构建重新签名都会拿到新时间戳，所有二进制的签名段随之变化。29% 左右是 macOS 签名包差分的现实基线，不要拿 Windows 的比例做验收标准。

这个结果说明：

- blockmap、Range 请求与手工播种的基线都已实际工作。
- 想进一步压低下载量，方向是减少「每次构建都会变的字节」，而不是改下载协议；但签名时间戳无法规避，收益空间有限。
- 暂存窗口远短于预期（3.4 秒），因为解包与验签发生在退出之后。5.3 的 600 秒兜底是余量，不是常态耗时。

## 13. 发布前检查清单

### 构建

- [ ] 版本号高于已发布版本。
- [ ] stable 使用 `package.json` 正式版本；test 才使用 `VETTA_DESKTOP_BUILD_VERSION` 覆盖。
- [ ] 签名凭据齐全，`security find-identity` 有 1 valid identity。
- [ ] arm64 与 x64 都已构建，且属于同一版本。
- [ ] `merge:updates:mac` 已执行，`latest-mac.yml` 同时引用两套 ZIP 与 DMG。
- [ ] `VETTA_REQUIRE_MAC_SIGNATURE=1 bun run verify:updates:mac` 通过。

### R2/Cloudflare

- [ ] URL path 与 R2 prefix 一致。
- [ ] test/stable 没有混用。
- [ ] ZIP、DMG、blockmap 可公开读取。
- [ ] ZIP Range 请求返回 206。
- [ ] `latest-mac.yml` 是短缓存，版本化产物是 immutable。
- [ ] 清单最后发布。

### 客户端闭环

- [ ] 旧签名版本能检查到新版本（不能用未签名旧包验证）。
- [ ] 进度到 90% 后能自行走到 ready，没触发 600 秒兜底。
- [ ] 重启后无「已损坏」弹窗，版本号与内置 runtime 都是新版本。
- [ ] 再发布一个极小改动版本，确认实际下载量没有退化。

## 14. 关键实现文件

| 文件 | 职责 |
|---|---|
| `packages/desktop-app/src/main/updater.ts` | 按平台装配引擎；macOS 注入原生 `autoUpdater` 事件源 |
| `packages/desktop-app/src/main/updater-service.ts` | 平台无关的状态机、自动下载、重试、停滞与暂存超时 |
| `packages/desktop-app/src/main/updater-engine.ts` | electron-updater 适配、进度压缩、Squirrel.Mac 暂存等待 |
| `packages/desktop-app/scripts/prepare-pack.js` | `resolveMacSigning()` 决定签名开关；生成 electron-builder 配置 |
| `packages/desktop-app/scripts/verify-mac-update.mjs` | 发布前清单、哈希、签名、公证票据校验 |
| `packages/desktop-app/scripts/merge-mac-update-metadata.mjs` | 合并双架构 `latest-mac-<arch>.yml` |
| `scripts/release-mac.sh` | 构建 + 校验 + 合并 + 发布的一键入口，含全部前置校验 |
| `packages/desktop-app/scripts/publish-update-artifacts-r2.mjs` | R2 原子发布、缓存头、幂等校验（跨平台共用） |
| `packages/desktop-app/build/entitlements.mac.plist` | hardened runtime entitlements |
| `docs/deploy/apple-code-signing.md` | 证书申请、公证凭据、注入与故障排查 |
| `.github/workflows/desktop-release.yml` | 三平台构建及 R2/GitHub Release 发布编排 |

修改更新链路时，必须同步检查状态机、签名与公证、双架构产物、元数据合并、R2 发布和真实旧版升级六个层面；仅让其中一个层面的测试通过不足以证明更新可用。
