# Windows 代码签名（Authenticode）

本文说明如何为 Windows 产物签名，以及**为什么必须签**。

## 为什么必须签

未签名的 exe / 安装包在 Windows 11 上会命中两类拦截：

- **智能应用控制（Smart App Control）**：直接阻止运行，提示「我们已阻止此应用以帮助保护你的设备和数据」「无法验证其发布者」；
- **SmartScreen**：可以运行，但每次都要「更多信息 → 仍要运行」，用户信任成本极高。

免签名是**受支持的构建路径**：没配凭据就产出未签名安装包（CI 只输出一条 warning），
用户首次运行时经「更多信息 → 仍要运行」放行即可。签名只是让拦截消失的手段，不是构建前提。
希望强制签名（例如对外正式渠道）时，把仓库变量 `ASTRAVIA_REQUIRE_WINDOWS_SIGNATURE` 设为 `1`。

## 凭据形态

二选一，都通过环境变量传入：

| 变量 | 说明 |
| --- | --- |
| `WIN_CSC_LINK` | PFX 文件的**路径**或 **base64** 内容（CI 里通常放 secret） |
| `WIN_CSC_KEY_PASSWORD` | PFX 密码 |
| `ASTRAVIA_WINDOWS_SIGN_SHA1` | 已装在证书存储里的证书指纹（`signtool /sha1`） |

`CSC_LINK` / `CSC_KEY_PASSWORD` 也接受，便于与 macOS 共用一份 CI 配置。

可选：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ASTRAVIA_WINDOWS_TIMESTAMP_URL` | `http://timestamp.digicert.com` | RFC 3161 时间戳；没有它，证书过期后签名一起失效 |
| `ASTRAVIA_REQUIRE_WINDOWS_SIGNATURE` | 未设置 | 设为 `1` 时缺少凭据直接构建失败；默认不设，免签名构建是支持路径 |

**只配一半会直接报错**：只有密码没有 PFX、只有 PFX 没有密码，都不会被当成「未签名」放过去。

## 签名发生在哪里

顺序在这里是关键：**签名必须是对 PE 的最后一次写入**，否则签名作废、SmartScreen 仍显示未签名。

```
electron-builder 打包（win，target=dir）
  └ afterPack：windows-version-layout.mjs
      1. 构建 Go 启动器 Astravia.exe
      2. 生成版本目录 versions/<版本>/
      3. 写入应用图标（resedit，改 PE 资源）
      4. 签名 versions/<版本>/Astravia.exe 与 根目录 Astravia.exe   ← 最后一步
Inno Setup 生成安装包
  └ 签名 Astravia-<版本>-win-<arch>.exe（在生成 blockmap / latest.yml 之前）
```

因此**不要在签名之后再改 exe**（包括换图标、改版本信息）。若需要换图标，改完必须重签。

## 工具

| 平台 | 工具 | 获取方式 |
| --- | --- | --- |
| Windows | `signtool.exe` | Windows SDK / Visual Studio 自带，或 `winget install Microsoft.WindowsSDK` |
| macOS / Linux | `osslsigncode` | `brew install osslsigncode` / `apt install osslsigncode` |

两者都找不到且确实配置了凭据时，构建直接失败，不会产出「以为签了」的包。

## 本地验证

```powershell
# 查看签名与时间戳
signtool verify /pa /v apps/desktop/release/win-unpacked/Astravia.exe
Get-AuthenticodeSignature apps/desktop/release/Astravia-0.5.101-win-x64.exe | Format-List Status, SignerCertificate
```

`Status` 应为 `Valid`；`TimeStamperCertificate` 非空表示时间戳已写入。

## 签名能消除什么、不能消除什么

- **能**：智能应用控制不再因「未签名」阻止；SmartScreen 从「未知发布者」变成证书主体名。
- **不能**：新证书的**信誉**需要积累。刚签完的包可能仍触发 SmartScreen 提示，直到下载量足够；
  用户可点「更多信息 → 仍要运行」。想彻底消除，需要 EV 证书（可即时获得信誉）。

## 与更新链路的关系

`latest.yml` 里的 `sha512` 与 `.blockmap` 必须基于**签名后**的安装包计算，所以
`build-inno-installer.mjs` 先签名、再生成 blockmap 与 metadata。改动这个顺序会让自动更新校验失败。

## 相关

- macOS 对应文档：[apple-code-signing.md](./apple-code-signing.md)
- 打包与版本目录布局：[../desktop/windows-auto-update.md](../desktop/windows-auto-update.md)
