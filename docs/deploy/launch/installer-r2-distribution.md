# 应用安装包生成与 R2 分发方案（官网 dl 直链下载）

> 目标：生成 Astravia 桌面应用安装包（macOS dmg / Windows exe / Linux AppImage）→ 上传到 R2 桶 `astravia-downloads` 的 `app/` 目录 → 官网下载按钮改为 `dl.astravia.dev` 直链，**不再依赖 GitHub Releases 按钮**（GitHub Releases 仅保留为源码/历史归档，可选下线）。
>
> 前置：R2 桶已建、`dl.astravia.dev` 已绑定并验证（见 [cloudflare-setup-checklist.md](cloudflare-setup-checklist.md) 第 6 节）；插件直链 `https://dl.astravia.dev/plugins/...` 已上线。本方案只处理应用安装包。

---

## 0. 版本一致性（先读，避免白打包）

| 版本来源 | 值（2026-08-30 现状） | 说明 |
|---|---|---|
| 官网 `website/index.html` 下载区 | `v0.55.32` | 硬编码文案 + 三个文件名 |
| 桌面包 `packages/desktop-app/package.json` `version` | `0.55.32` | electron-builder 产物版本取自这里；**0.55.32 为当前已发布版本**（桶内 `app/v0.55.32/`），上一版为 0.55.31 开发版、线上 0.55.3 |
 | 发版版本源（AGENTS.md） | `@astravia/coding-agent` | 锁步发版，见 [desktop-releases.md](../desktop-releases.md) |

- **打包产物名 = `astravia-<实际版本>-mac.dmg` 等**，由 electron-builder 从 desktop-app 的 `package.json` 版本生成；版本号不一致时，产物名、官网文件名、R2 目录会互相打架。
- 下文统一用 `<VER>` 占位版本号；**执行时以实际发布的版本为准**，三处必须一致：
  1. `packages/desktop-app/package.json` 的 `version`
  2. R2 目录 `app/v<VER>/`
  3. 官网 `index.html` 文件名与文案

---

## 1. 生成安装包

### 1.1 命令（在 `packages/desktop-app/` 目录下执行）

| 平台 | 命令 | 产物（`release/` 目录） |
|---|---|---|
| macOS（Apple Silicon） | `bun run dist:mac:arm64` | `astravia-<VER>-mac-arm64.dmg` + `-mac-arm64.zip` + `.blockmap` |
| macOS（Intel） | `bun run dist:mac:x64` | `astravia-<VER>-mac-x64.dmg` + `-mac-x64.zip` + `.blockmap` |
| Windows（x64，Inno 安装器） | `bun run dist:win` | `astravia-<VER>-win.exe` + `.blockmap` |
| Linux（AppImage） | `bun run dist:linux:appimage` | `astravia-<VER>-linux.AppImage` |

- 跨三平台需在对应系统上打包（mac 产物只能在 macOS 出，win 产物可在 Windows 或 CI 出）；正式发布走现有 CI `.github/workflows/desktop-release.yml`（一个 tag 出三平台）。
- `prebuild:pack` 已含：clean、prepare:windows、prepare:bwrap、prepare:ocr-models、build、prepare-pack；`dist:*` 命令自动串联，**不要手动单跑**。
- electron-builder 配置由 `scripts/run-electron-builder.js` 在构建期生成（`build/electron-builder.json`），产物统一进 `release/`。

### 1.2 签名与公证（macOS 强制，Windows 推荐）

 - **macOS**：必须开发者 ID 签名 + 公证，否则用户无法打开（Gatekeeper）。配置与密钥要求见 [apple-code-signing.md](../apple-code-signing.md)。未签名产物只能内部测试，不能作为对外下载。
 - **Windows**：SmartScreen 会拦截未签名安装包；签名证书（EV/OV 或自签）配置见 [windows-auto-update.md](../../desktop/windows-auto-update.md)。
- **Linux**：AppImage 无需签名，但建议在 README 注明校验方式。

### 1.3 产物核对（打包完成后）

```bash
cd packages/desktop-app
ls -la release/
# 期望看到：dmg/zip/blockmap（mac）、exe/blockmap（win）、AppImage（linux）、latest.yml、latest-mac.yml
```

- `latest.yml`（Windows 更新元数据）与 `latest-mac.yml`（macOS 更新元数据）由 electron-builder 自动生成，**上传 R2 时必须一起传**（应用内自动更新读它们）。

---

## 2. 上传到 R2（`app/v<VER>/`）

桶内结构（与已上线的 `plugins/` 分区共存）：

```
astravia-downloads/                 ← R2 桶
├── plugins/                        ← 已上线（插件包）
│   ├── web-element-picker-extension-0.3.2.zip   # 浏览器扩展（MV3 商店包）
│   └── web-element-picker-builtin-0.2.4.zip     # 桌面应用内置插件包
└── app/
    └── v<VER>/                     ← 版本目录
        ├── astravia-<VER>-mac.dmg / -mac.zip / .blockmap
        ├── astravia-<VER>-win.exe / .blockmap
        ├── astravia-<VER>-linux.AppImage
        ├── latest.yml              # Windows 自动更新元数据
        └── latest-mac.yml          # macOS 自动更新元数据
```

### 方式 A：控制台手动上传（一次性、量少）

1. R2 → `astravia-downloads` → 进入 `app/` → `+ Add folder` 建 `v<VER>`（或直接 `Upload objects` 时建路径）
2. 拖入上述全部文件
3. 验证：浏览器打开 `https://dl.astravia.dev/app/v<VER>/astravia-<VER>-mac.dmg` 能下载

### 方式 B：现有发布脚本（推荐，自动校验 + 防覆盖 + 缓存头正确）

仓库已内置 `publish:updates:r2`（`verify-update-artifacts.mjs && publish-update-artifacts-r2.mjs`），会自动：读 `release/` 的 `latest*.yml` → 收集被引用产物 + blockmap → 先传产物、后传元数据 → HEAD 验证公共 URL。防降级、防覆盖、带 sha512 元数据。

**前提：创建 R2 API Token（S3 兼容凭证）**
1. Cloudflare 控制台 → **R2 → Manage R2 API Tokens → Create API token**
2. 权限：对象读+写（`Object Read & Write`），范围选桶 `astravia-downloads`（或账号级）
3. 生成后得到三个值：**Account ID**（R2 页面顶部）、**Access Key ID**、**Secret Access Key**（只显示一次，立即保存）

**执行**（`packages/desktop-app/` 下）：

```bash
export ASTRAVIA_R2_ACCOUNT_ID=<account-id>
export ASTRAVIA_R2_ACCESS_KEY_ID=<access-key-id>
export ASTRAVIA_R2_SECRET_ACCESS_KEY=<secret-access-key>
export ASTRAVIA_R2_BUCKET=astravia-downloads
export ASTRAVIA_R2_PREFIX=app/v<VER>                        # 默认 desktop/stable，这里改成版本目录
export ASTRAVIA_UPDATE_URL=https://dl.astravia.dev/app/v<VER>
bun run publish:updates:r2
```

脚本约束（不满足会报错，属正常保护）：
- `ASTRAVIA_UPDATE_URL` 路径必须与 `ASTRAVIA_R2_PREFIX` 一致
- 目标目录已存在同版本对象且内容不同 → 拒绝覆盖（防误传）；重传需先删旧对象
- 版本号必须 `x.y.z` 且不低于远端（防降级）

---

## 3. 验证 dl 直链

```bash
curl -s -o /dev/null -w "%{http_code} %{size_download}\n" https://dl.astravia.dev/app/v<VER>/astravia-<VER>-mac.dmg
curl -s -o /dev/null -w "%{http_code}\n" https://dl.astravia.dev/app/v<VER>/latest.yml
curl -s -o /dev/null -w "%{http_code}\n" https://dl.astravia.dev/app/v<VER>/latest-mac.yml
```

期望全部 200；手机流量再验证一次（排除本机缓存）。

### 3.1 下载完整性 + 未签名包实测（2026-08-29，v0.55.3）

**CDN 分发完整性（sha512 对比）**

```bash
# 从 CDN 下载后与本地产物比对
shasum -a 512 <下载的.dmg>
# 与 release/latest-mac.yml 中该文件条目对比（YAML 里是 base64，解码后应一致）
grep -A2 "arm64.dmg" packages/desktop-app/release/latest-mac.yml
```

实测结论：`dl.astravia.dev` 下载的 dmg 258,674,519 B，sha512 与本地产物及 `latest-mac.yml` 记录**完全一致**；`hdiutil attach` 挂载正常，卷内为 `Astravia.app`（arm64、版本号正确）+ `Applications` 软链。**文件本身可正常使用。**

**未签名包的 Gatekeeper 行为（当前产物无签名）**

- 构建配置 `identity: null`，`codesign -dv` 显示 `adhoc / linker-signed`——从浏览器下载后带 quarantine 标记，首次双击提示「无法验证开发者」或「已损坏」。
- 绕过方法（三选一）：
  1. 右键应用 →「打开」→ 再次点「打开」
  2. `xattr -dr com.apple.quarantine /Applications/Astravia.app`
  3. 系统设置 → 隐私与安全性 → 允许「任何来源」
 - **临时方案**：未签名包只能用于自测 / 小范围分发；正式对外发布必须 Developer ID 签名 + 公证（见 [apple-code-signing.md](../apple-code-signing.md)），否则普通用户会被 Gatekeeper 拦截。

**安装后 Launchpad 出现两个同名图标**

- 常见原因：dmg 卷仍挂载（`/Volumes/Astravia ...`），Launchpad 会把卷内 `Astravia.app` 与已安装的 `/Applications/Astravia.app` 同时列出，看起来「装了两次」。
- 解决：`hdiutil detach "/Volumes/Astravia ..."` 卸载卷（或在访达推出磁盘）；若 Launchpad 未刷新，退出重开。
- dmg 内附带的 `修复已损坏.app` 是项目自带的辅助工具（用于绕过 Gatekeeper 提示），**不是病毒、无需安装**；安装时只拖 `Astravia.app`，不要把它拖进 `/Applications`。

---

## 4. 官网切换为 dl 直链（`website/index.html`）

**时机**：安装包已上传且直链 200 之后再改，否则按钮 404。修改点（下载区，约第 297–344 行）：

| 位置 | 现状 | 改为 |
|---|---|---|
| 下载区 lead（L303） | `三平台安装包托管在 GitHub Releases` | `三平台安装包托管在 R2 下载站，免注册、免费、开源` |
| macOS 按钮 href（L314） | `https://github.com/sikongyue/astravia/releases/latest` | `https://dl.astravia.dev/app/v<VER>/astravia-<VER>-mac.dmg` |
| Windows 按钮 href（L323） | 同上（releases/latest） | `https://dl.astravia.dev/app/v<VER>/astravia-<VER>-win.exe` |
| Linux 按钮 href（L332） | 同上（releases/latest） | `https://dl.astravia.dev/app/v<VER>/astravia-<VER>-linux.AppImage` |
| 下载注释（L338） | `所有安装包在 GitHub Releases 按版本归档` | `所有安装包在 R2 下载站按版本归档（dl.astravia.dev），自动更新由应用内配置决定` |
| 三个文件名（L313/322/331） | `astravia-0.55.3-*` | 同步为实际版本 |

同时：
- 删/改导航与首屏的 `releases/latest` 按钮（L53、L70），保持统一指向下载区或直链
 - 发版时按 [website/README.md](../../../website/README.md)「内容维护」同步 `package.json` version
- 若希望保留「GitHub 查看源码」入口，**只改下载按钮**，源码按钮（`github.com/sikongyue/astravia`）保留不动

---

## 5. 应用内自动更新源指向 dl（发版时配置）

打包时把 electron-updater 源设为 R2（generic 源），构建命令注入：

```bash
export ASTRAVIA_UPDATE_PROVIDER=generic
export ASTRAVIA_UPDATE_URL=https://dl.astravia.dev/app/v<VER>
```

- 解析逻辑见 `packages/desktop-app/scripts/resolve-update-publish-config.mjs`：`generic` 需要 `ASTRAVIA_UPDATE_URL`；`github` 需要 owner/repo（旧方案）
 - 完整配置与验证见 [windows-auto-update.md](../../desktop/windows-auto-update.md)（Windows，含 Inno 版本目录启动器）与 [macos-auto-update.md](../../desktop/macos-auto-update.md)（macOS，Squirrel.Mac）
- 发布后自验：`bun run verify:updates:windows` / `verify:updates:mac` / `verify:updates:linux`

---

## 6. 收尾清理

- **GitHub Releases**：下载按钮全部下线后，Releases 保留作为源码/历史版本归档即可，无需删除（auto-update 已切换到 generic 源后不再依赖它）
- **占位记录**：确认 DNS 无残留 `185.53.179.128` 等旧 A 记录
- **文档同步**：本方案落地后更新 [cloudflare-setup-checklist.md](cloudflare-setup-checklist.md) 第 8 节验证表的「下载直链 / 更新元数据」行（路径从 `v0.1.0` 示例改为实际版本）

---

## 7. 验证清单（全部通过才算完成）

| 检查项 | 方法 | 期望 |
|---|---|---|
| 三平台产物存在 | `ls packages/desktop-app/release/` | dmg/zip/exe/AppImage + blockmap + latest*.yml |
| 直链可下载 | `curl -I https://dl.astravia.dev/app/v<VER>/astravia-<VER>-mac.dmg` | 200 |
| 元数据可读 | `curl https://dl.astravia.dev/app/v<VER>/latest.yml` | YAML、version 与 `<VER>` 一致 |
| 官网按钮已换 | 打开 `https://www.astravia.dev` 点下载 | 跳到 dl 直链，非 GitHub |
| 官网文件名与版本 | 检查 index.html 三处文件名 | 与实际版本一致 |
| 自动更新源 | 应用内检查更新 | 从 dl.astravia.dev 拉 latest*.yml |
| 跨网络验证 | 手机流量再下载一次 | 正常 |
