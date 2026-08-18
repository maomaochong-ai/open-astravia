# 8. 当前实现与部署配置

## 8.1 已实现边界

当前 desktop 已落地以下闭环：

- `@sentry/electron/main` 覆盖 Main、原生崩溃和 Renderer 事件接收；
- Main、Pet、Quick Panel、Onboarding 的 Renderer 均初始化 Sentry；
- 四个 preload 入口均初始化 Sentry；
- React 主窗口的 caught/recoverable render error 显式发送给 Sentry；
- Sentry 关闭截图和默认 PII，事件发送前移除请求体、认证 header、Cookie、query string，并脱敏 token、JWT 和邮箱；
- `posthog-node` 复用已存在的 `AppMonitorEvent` 白名单作为产品事件入口；
- PostHog 不接收错误堆栈、错误正文、资源名称、prompt 名称、文件路径和设置值；
- `posthog-js` 负责匿名身份、Feature Flag 和可选 Session Replay；
- PostHog 异常自动采集、autocapture、pageview 自动采集均关闭；
- Sentry event 与 PostHog event 共享 `app_session_id`，并在 Replay 启用时共享 `posthog_session_id`；
- 缺少 Sentry/PostHog 配置时对应 SDK 为 Noop，不阻断应用启动和退出。

## 8.2 运行时变量

| 变量 | 必填条件 | 用途 |
|---|---|---|
| `VETTA_SENTRY_DSN` | 启用 Sentry 时 | Main Sentry DSN；Renderer/Preload 通过 Electron SDK IPC 转发 |
| `VETTA_SENTRY_RELEASE` | 正式发布时 | Sentry event 与 source map 使用的不可变 release |
| `VETTA_TELEMETRY_ENVIRONMENT` | 建议 | `production`、`staging` 等环境名 |
| `VETTA_SENTRY_TRACES_SAMPLE_RATE` | 可选 | `0` 到 `1`；缺省为 `0`，不自动开启性能采样 |
| `VETTA_POSTHOG_KEY` | 启用 PostHog 时 | PostHog Project API Key；会被内联到 Renderer，不能使用私密 Personal API Key |
| `VETTA_POSTHOG_HOST` | 可选 | PostHog ingest host，缺省为 `https://us.i.posthog.com` |
| `VETTA_POSTHOG_REPLAY_ENABLED` | 启用 Replay 时 | 只有值为 `true` 才允许录制 |
| `VETTA_POSTHOG_REPLAY_SAMPLE_RATE` | 可选 | `0` 到 `1`；未设置时由 PostHog 项目端采样配置决定 |

PostHog Replay 使用以下本地强制隐私配置：

- 全部 input 遮罩；
- 全部文本遮罩；
- `.ph-no-capture` 和 `[data-telemetry-private]` 节点不录制；
- 不记录 request/response body 和 header；
- 不记录跨域 iframe；
- 不记录 Canvas。

## 8.3 Source map 上传变量

只有以下四项同时存在时，三个 Vite 构建才启用 hidden source map 和 Sentry 上传插件：

| 变量 | 用途 |
|---|---|
| `VETTA_SENTRY_AUTH_TOKEN` | Source map 上传凭据；只能通过 CI Secret 或本地临时环境变量注入 |
| `VETTA_SENTRY_ORG` | Sentry organization slug |
| `VETTA_SENTRY_PROJECT` | Sentry project slug |
| `VETTA_SENTRY_RELEASE` | 与运行时完全一致的 release |

自托管 Sentry 还可设置 `VETTA_SENTRY_URL`。上传成功后构建脚本删除 `dist/main`、`dist/preload`、`dist/renderer` 下的 `.map`，防止 source map 进入安装包。任一必填项缺失时不启用上传插件，不进行半配置上传。

## 8.4 当前产品事件

现有业务继续调用 `window.vetta.appMonitor.recordEvent`。Main 完成 schema 校验后，一份写入本地 App Monitor，另一份转换为低敏 PostHog 事件：

- `input_attachments_added`；
- `input_action_toggled`；
- `input_action_used`；
- `input_context_used`；
- `resource_lifecycle_changed`；
- `settings_changed`；
- `app_session_started`；
- `auth_state_changed`。

转换时只保留数量、类别、操作类型和布尔值。资源 ID、action ID、prompt 名称和设置 value 不发送到 PostHog。

## 8.5 尚未自动化的外部工作

以下工作依赖部署平台或产品决策，不在本次代码装配内自动执行：

- 在 Sentry 创建告警规则、Issue ownership 和留存策略；
- 在 PostHog 控制台配置 Replay 服务端采样、Feature Flag 和实验；
- 可选启用 PostHog Sentry Source；
- 增加面向最终用户的独立“错误报告”和“产品分析/Replay”授权设置；
- 在 staging 触发受控 Main、Preload、Renderer、native crash，验证 source map 和 Replay 关联。
