# Desktop Telemetry：Sentry 与 PostHog 集成方案

本文档集描述 Vetta desktop 的固定双主系统遥测方案：

> **Sentry 负责工程可靠性，PostHog 负责产品洞察；两者通过统一身份和关联 ID 协作。**

本方案不追求 Sentry/PostHog 的自由切换，也不把两者抽象成能力完全等价的平台。目标是明确数据主责、避免重复采集，并让错误详情、用户行为和 Session Replay 可以相互定位。

## 职责结论

| 能力 | 主系统 |
|---|---|
| Main/Preload/Renderer 异常 | Sentry |
| Electron 原生崩溃 | Sentry |
| Source map、Release、Issue、告警 | Sentry |
| 性能追踪 | Sentry |
| 产品事件、漏斗、留存、用户路径 | PostHog |
| Session Replay | PostHog |
| Feature Flag、实验、Survey | PostHog |
| 本地诊断日志 | electron-log |

明确关闭重叠能力：

- 不启用 PostHog Error Tracking 和异常自动采集；
- 不启用 Sentry Session Replay；
- 不向 PostHog 发送异常堆栈和错误正文；
- 不用 Sentry 记录产品分析事件；
- 不全量上传现有本地日志、console、请求体或响应体。

## 集成原则

1. 业务代码依赖 Vetta 自有的窄接口，不直接调用 Sentry/PostHog SDK。
2. Sentry/PostHog SDK 只存在于 desktop 的装配层和专用 adapter。
3. 主 Renderer 建立匿名 ID、App Session ID 和 PostHog Session ID，并通过受限 IPC 同步给 Main/Sentry。
4. Sentry 保存完整错误；PostHog 只保存低敏感度的“用户遇到错误”产品事件。
5. Sentry event 与 PostHog session/replay 通过 correlation ID 双向关联。
6. PostHog Replay 采用默认全部遮罩、明确允许显示的策略。
7. 任一平台故障不得影响应用主流程或应用退出。

## 文档导航

1. [01-goals-and-decisions.md](01-goals-and-decisions.md)：目标、非目标、职责边界和关键决策。
2. [02-target-architecture.md](02-target-architecture.md)：整体数据流、仓库落点和依赖方向。
3. [03-event-contract.md](03-event-contract.md)：统一身份、错误契约、产品事件和关联模型。
4. [04-electron-capture.md](04-electron-capture.md)：Main、Preload、Renderer 的采集与生命周期。
5. [05-sentry-posthog-integration.md](05-sentry-posthog-integration.md)：两套系统的关联、去重和数据同步。
6. [06-source-maps-and-native-crashes.md](06-source-maps-and-native-crashes.md)：Sentry source map、Electron 原生崩溃和隐私。
7. [07-rollout-and-acceptance.md](07-rollout-and-acceptance.md)：实施路线、测试矩阵和验收标准。
8. [08-current-implementation.md](08-current-implementation.md)：当前代码落点、环境变量和已实现边界。

## 推荐首版范围

- Sentry Electron 覆盖 Main、Preload、Renderer 和原生崩溃；
- Sentry CI source map 上传与 release 对齐；
- PostHog 产品事件目录；
- PostHog Renderer Session Replay，使用最大隐私配置；
- 统一 TelemetryContext；
- 仅对用户有影响的错误发送 desktop.error_experienced；
- Sentry event 与 PostHog session 双向关联；
- 可选配置 PostHog Sentry Source，用于离线联合分析。

## 参考资料

- [Sentry Electron](https://docs.sentry.io/platforms/javascript/guides/electron/)
- [Sentry Issue Details 与 Replay 关联](https://docs.sentry.io/product/issues/issue-details/)
- [Sentry source map troubleshooting](https://docs.sentry.io/platforms/javascript/guides/hono/sourcemaps/troubleshooting_js)
- [PostHog 与 Sentry 对比](https://posthog.com/blog/posthog-vs-sentry)
- [PostHog Session Replay 隐私控制](https://posthog.com/docs/session-replay/privacy)
- [PostHog Session Replay 录制规则](https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record)
- [PostHog Sentry Source](https://posthog.com/docs/cdp/sources/sentry)
- [Electron crashReporter](https://www.electronjs.org/docs/latest/api/crash-reporter)
