# 构建模式与环境变量

*[English](./build-modes.en.md)*

Vetta Desktop 有两种构建形态，由构建期开关 `VETTA_CLOUD_ENABLED` 决定。

| | **lite（serv-less）** | **完全体（Vetta Serv）** |
| --- | --- | --- |
| 开关 | 默认，无需配置 | `VETTA_CLOUD_ENABLED=true` |
| 账号登录 / OAuth | ❌ 代码不进产物 | ✅ |
| Vetta Go 模型渠道 | ❌ | ✅ |
| 订阅 / 积分 / 配额 | ❌ | ✅ |
| 能力广场来源 | GitHub 仓库 | 官方市场 |
| 远程模型目录下发 | ❌ | ✅ |
| 内置技能 | 不含 `requiresCloud` 标记的 | 全部 |

**两种模式共有**：本地会话、编码 Agent、插件系统、主题、自带 API Key 的模型、IM 旁路、知识库。

> `VETTA_CLOUD_ENABLED` 是**构建期**开关，经常量折叠写死进产物：lite 构建里 cloud 模块连同它的 chunk 都不会被打包。**发包之后无法由运行环境重新开启**，切换必须重新构建。

---

## lite 构建（默认）

什么都不配就是 lite。唯一建议配的是能力广场来源，否则广场会是空的：

```bash
# apps/desktop/.env.development
VETTA_OPEN_MARKETPLACE_REPOSITORY=https://github.com/openvetta/vetta-official-marketplace
```

然后正常构建：

```bash
bun install
bun run build:desktop
```

lite 模式**不需要** `VETTA_SERVER_URL`——登录、网关、官方市场与远程模型目录都不在产物里，它没有实际消费方。

## 完全体构建

需要一个可用的 Vetta 服务端：

```bash
# apps/desktop/.env.production（本地文件，不提交）
VETTA_CLOUD_ENABLED=true
VETTA_SERVER_URL=https://api.example.com/api/v1
VETTA_SITE_URL=https://www.example.com
```

`VETTA_SERVER_URL` 在完全体下是必填的，构建期和运行期各有一道校验会拦住缺失的情况——缺了它会在运行期一路失败到「Unknown provider」才暴露。

`VETTA_SITE_URL` 可省略，会从 `VETTA_SERVER_URL` 推导：去掉 `api.` 前缀、端口 `8080` 换 `3000`。

---

## 环境变量文件

`.env.*` 一律不纳入版本控制。`apps/desktop/.env.example` 是变量索引，复制成 `.env.development` 后按需修改。

打包时用 `VETTA_BUILD_ENV=<mode>` 指定加载哪个 `.env.<mode>`：

```bash
VETTA_BUILD_ENV=production bun run pack     # 读 .env.production
bun run pack:test                           # 等价于 VETTA_BUILD_ENV=test
```

优先级：**命令行内联 > 进程环境变量 > `.env.<mode>` > `.env` > 代码默认值**。

### 参考：典型的 `.env.production`

本团队官方发版用的配置，供参考——你的生产端点、更新源、租户大概率不同：

```bash
VETTA_CLOUD_ENABLED=true
VETTA_SERVER_URL=https://api.openvetta.com/api/v1
VETTA_SITE_URL=https://www.openvetta.com
VETTA_UPDATE_PROVIDER=generic
VETTA_UPDATE_URL=https://releases.openvetta.com/desktop/stable
VETTA_R2_BUCKET=vetta-releases
VETTA_R2_PREFIX=desktop/stable
VETTA_TENANT=common
VETTA_SPEECH_INPUT_ENABLED=false
```

### 参考：典型的 `.env.test`

```bash
VETTA_SERVER_URL=http://127.0.0.1:8080/api/v1
VETTA_UPDATE_PROVIDER=none
```

---

## 变量参考

### 模式与服务地址

| 变量 | 说明 |
| --- | --- |
| `VETTA_CLOUD_ENABLED` | `true` 产出完全体；缺省或其它值均为 lite |
| `VETTA_SERVER_URL` | 服务端 API 端点。完全体必填，lite 不需要 |
| `VETTA_SITE_URL` | 站点地址，用于 OAuth 登录跳转。缺省从 `VETTA_SERVER_URL` 推导 |
| `VETTA_OPEN_MARKETPLACE_REPOSITORY` | lite 的能力广场来源仓库 |
| `VETTA_OPEN_MARKETPLACE_REF` | 分支或标签，缺省 `main` |
| `VETTA_OPEN_MARKETPLACE_ARCHIVE_URL` | 直接指定归档地址，省略时由仓库与 REF 推导 |

### 构建期裁剪

| 变量 | 说明 |
| --- | --- |
| `VETTA_SPEECH_INPUT_ENABLED` | `false` 时不打包语音模型、Sherpa 原生运行时与语音入口。缺省开启 |
| `VETTA_TENANT` | 系统插件租户，决定打包哪些 preset 插件。取值见 `packages/plugins/tenants.json` |
| `VETTA_BUILD_ENV` | 指定加载哪个 `.env.<mode>` |

### 开发期开关

| 变量 | 说明 |
| --- | --- |
| `VETTA_SHOW_UI_THEME` | `true` 时在外观设置里显示「界面主题」区段 |

### 自动更新

| 变量 | 说明 |
| --- | --- |
| `VETTA_UPDATE_PROVIDER` | `none` / `generic` / `github` |
| `VETTA_UPDATE_URL` | `generic` 用，适用于 R2、自建对象存储或任意静态 HTTP/CDN 根路径 |
| `VETTA_UPDATE_GITHUB_OWNER` · `VETTA_UPDATE_GITHUB_REPO` | `github` 用 |
| `VETTA_R2_BUCKET` · `VETTA_R2_PREFIX` | R2 上传目标，仅 `publish:updates:r2` 使用 |

更新源是构建配置，与操作系统无关；切换 provider 无需修改客户端代码。平台细节见 [macOS](./macos-auto-update.md) 与 [Windows](./windows-auto-update.md)。

### 可观测性

| 变量 | 说明 |
| --- | --- |
| `VETTA_SENTRY_DSN` | 未配置时 Sentry 为 Noop。DSN 会进入构建产物 |
| `VETTA_SENTRY_RELEASE` | 不可变 release，运行时与 Source Map 上传必须一致。推荐 `vetta-desktop@<version>+<build-id>` |
| `VETTA_TELEMETRY_ENVIRONMENT` | `development` / `staging` / `production` |
| `VETTA_SENTRY_TRACES_SAMPLE_RATE` | 0～1，缺省 0 |
| `VETTA_SENTRY_ORG` · `VETTA_SENTRY_PROJECT` · `VETTA_SENTRY_URL` | Source Map 上传（仅 CI），`URL` 仅自托管需要 |
| `VETTA_MAIN_SOURCEMAP` | 仅本地调试 Main 堆栈时单独生成 Source Map |
| `VETTA_POSTHOG_KEY` | Project API Key（`phc_` 开头），**不是** Personal API Key。会进入 Renderer 产物 |
| `VETTA_POSTHOG_HOST` | 缺省 PostHog Cloud US |
| `VETTA_POSTHOG_REPLAY_ENABLED` · `VETTA_POSTHOG_REPLAY_SAMPLE_RATE` | Replay 默认关闭 |
| `VETTA_TRACING` | 设为 `langfuse` 开启 Agent / LLM / 工具调用全链路 trace |
| `VETTA_TRACING_TRACE_NAME` · `LANGFUSE_PUBLIC_KEY` · `LANGFUSE_BASE_URL` | Langfuse 配置 |
| `LANGFUSE_TRACING_ENVIRONMENT` · `LANGFUSE_RELEASE` · `OTEL_SERVICE_NAME` | 可选元数据 |

---

## 机密变量

**以下变量不要写入任何 `.env` 文件**，只通过 shell 环境或 CI Secret 注入：

- **Cloudflare R2 上传凭据**：`VETTA_R2_ACCOUNT_ID`、`VETTA_R2_ACCESS_KEY_ID`、`VETTA_R2_SECRET_ACCESS_KEY`
- **macOS 签名与公证**：`CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_TEAM_ID`、`APPLE_API_*`
  CI 变体：`MACOS_CERTIFICATE_P12_BASE64`、`MACOS_CERTIFICATE_PASSWORD`、`APPLE_API_KEY_P8_BASE64`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`
  一个都不设则产出未签名包；要签名则必须全部齐全。流程见 [apple-code-signing.md](../deploy/apple-code-signing.md)
- **Sentry Source Map 上传**：`VETTA_SENTRY_AUTH_TOKEN`
- **Langfuse**：`LANGFUSE_SECRET_KEY`

`VETTA_REQUIRE_MAC_SIGNATURE=1` 仅供 macOS CI 产物校验步骤使用，不是客户端配置。

---

## CI

`.github/workflows/desktop-release.yml` 从仓库 Variables 读取构建配置。**fork 不配任何 Variables 就得到 lite 构建**；要产出完全体，在仓库 Settings → Variables 里设置：

```
VETTA_CLOUD_ENABLED = true
VETTA_SERVER_URL    = https://api.example.com/api/v1
VETTA_SITE_URL      = https://www.example.com
```

`workflow_dispatch` 只构建并保留 Actions Artifact；只有匹配 `package.json` 版本的正式 tag 才会发布到 R2 / GitHub Releases。
