# 3. 身份、错误和产品事件契约

## 3.1 独立接口

```typescript
export interface ErrorReporter {
  captureException(error: unknown, context?: ErrorContext): CapturedError;
  addBreadcrumb(breadcrumb: Breadcrumb): void;
  setUser(user: MonitoringUser | null): void;
  flush(timeoutMs?: number): Promise<void>;
}

export interface CapturedError {
  correlationId: string;
  providerEventId?: string;
}

export interface AnalyticsClient {
  track(event: AnalyticsEvent): void;
  identify(user: AnalyticsUser | null): void;
  flush(timeoutMs?: number): Promise<void>;
}
```

约束：

- ErrorReporter 由 Sentry adapter 实现；
- AnalyticsClient 由 PostHog adapter 实现；
- correlationId 由 Astravia 生成；
- providerEventId 是 adapter 返回的不透明平台事件 ID，只供 ErrorProductBridge 建立关联；
- capture/track 不得向调用方抛出 SDK 错误；
- 不提供通用 extra: Record<string, unknown>。

## 3.2 TelemetryContext

Main 创建统一上下文：

```typescript
export interface TelemetryContext {
  anonymousUserId: string;
  appSessionId: string;
  release: string;
  buildId: string;
  releaseChannel: string;
  environment: "development" | "test" | "production";
}
```

映射：

| Astravia 字段 | Sentry | PostHog |
|---|---|---|
| anonymousUserId | user.id | distinct_id |
| appSessionId | tag: app_session_id | property: app_session_id |
| release | release | property: app_release |
| buildId | dist/tag | property: app_build_id |
| releaseChannel | tag | property |
| environment | environment | property |

anonymousUserId 必须是不可逆派生值或匿名安装标识，不能直接使用邮箱、用户名、认证 token、聊天 session ID 或 IM 身份。

## 3.3 ErrorContext

```typescript
export interface ErrorContext {
  correlationId: string;
  process: "main" | "renderer" | "preload";
  window?: "main" | "pet" | "quickpanel" | "onboarding";
  feature?: string;
  operation?: string;
  handled: boolean;
  severity: "warning" | "error" | "fatal";
  userImpact: "none" | "degraded" | "blocked" | "crashed";
  posthogSessionId?: string;
  posthogReplayUrl?: string;
}
```

只把低基数值放入 Sentry tags。posthogReplayUrl 放入 context，不放 tag。绝对路径、错误 message、stacktrace 和用户输入不能成为 fingerprint 或 tag。

## 3.4 Breadcrumb

```typescript
export interface Breadcrumb {
  occurredAt: string;
  category: "navigation" | "ipc" | "lifecycle" | "network" | "user-action";
  level: "info" | "warning" | "error";
  message: string;
  data?: Readonly<Record<string, string | number | boolean>>;
}
```

限制：

- 最近最多 50 条；
- data 只允许基本类型；
- IPC 只记录 channel、耗时和结果类别；
- URL 去除 query、fragment 和本地路径；
- 不记录 prompt、模型响应、文件正文、终端输出和请求/响应 body；
- console 不能无差别转换为 breadcrumb。

## 3.5 产品事件目录

产品事件必须是强类型、语义稳定的 union：

```typescript
export type AnalyticsEvent =
  | {
      name: "desktop.session.started";
      properties: SessionStartedProperties;
    }
  | {
      name: "desktop.agent.run.completed";
      properties: AgentRunCompletedProperties;
    }
  | {
      name: "desktop.error.experienced";
      properties: ErrorExperiencedProperties;
    };
```

事件命名描述产品事实，不描述 UI 实现：

- 推荐 desktop.agent.run.completed；
- 不推荐 send_button_clicked；
- 推荐 desktop.update.failed；
- 不推荐 update_dialog_red_button_clicked。

事件属性采用白名单，不允许调用方追加任意属性。

## 3.6 用户影响错误 marker

完整异常只发送到 Sentry。只有 userImpact 为 degraded、blocked 或 crashed 时，ErrorProductBridge 才向 PostHog 发送 marker：

```typescript
export interface ErrorExperiencedProperties {
  errorCorrelationId: string;
  sentryEventId?: string;
  appSessionId: string;
  feature?: string;
  operation?: string;
  handled: boolean;
  userImpact: "degraded" | "blocked" | "crashed";
  release: string;
}
```

marker 禁止包含：

- exception message/type 原文；
- stacktrace；
- 文件路径；
- prompt、模型输出和聊天内容；
- IPC payload；
- 请求/响应 body；
- 终端内容。

PostHog marker 的用途是漏斗、影响范围和 Replay 时间线，不用于错误分组。

## 3.7 双向关联

```text
Sentry event
  correlation_id
  app_session_id
  posthog_session_id
  posthog_replay_url

PostHog desktop.error.experienced
  error_correlation_id
  sentry_event_id
  app_session_id
```

如果 PostHog session 尚未建立，Sentry 仍正常上报，不阻塞等待。Main-only 后台错误通常没有 Replay，不能伪造关联。

## 3.8 身份生命周期

- 应用启动：Main 生成 appSessionId。
- 匿名状态：使用匿名 installation 派生 ID。
- 登录成功：同时更新 Sentry user.id 和 PostHog distinct_id。
- 登出：清除两边用户身份，重新进入匿名上下文。
- 账号切换：先 reset 旧 PostHog identity，再设置新身份；Sentry 同步替换 user。
- appSessionId 不跨应用重启复用。
- 不把 conversation/session transcript ID 当作遥测 session。

## 3.9 隐私和规范化

Sentry 异常规范化至少覆盖 Error、Error.cause、AggregateError、非 Error rejection、循环引用和超长 stack。默认删除：

- Authorization、Cookie、API key、refresh/access token；
- IM App Secret；
- prompt、LLM 响应和聊天记录；
- 文件正文与终端完整输出；
- home/workspace 绝对路径中的用户名；
- URL query 和 fragment；
- local variables 和未经批准的 attachment。

PostHog 事件使用同样的基础身份规则，但不得接收 Sentry 的完整异常对象。
