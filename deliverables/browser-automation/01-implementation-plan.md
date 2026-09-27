# 浏览器自动化 —— 实现方案

> 演进说明：本文档对齐 open-vetta ADR-0088（Foundation Capability）和 ADR-0090（Session env 注入）。
> 决策依据：[docs/adr/0060-browser-automation-system-plugin-runtime-skill-shim-and-policy-gating.md](../docs/adr/0060-browser-automation-system-plugin-runtime-skill-shim-and-policy-gating.md)

---

## 1. 目标

让 astravia Agent 具备 **驱动真实 Chrome 浏览器** 的完整能力链：
- Agent 在对话框说"帮我去 GitHub 找一下 X 的 release" → Agent 自动开 Chrome → navigate → snapshot → 读列表 → 把结果返回
- 支持登录态持久化（persistent profile）、多标签页隔离、截图、表单交互
- 运行时依赖（agent-browser Rust 二进制 + Chrome for Testing）宿主托管 npm 拉取，版本锁死
- 危险动作（越界域名、eval/upload/download）由 BrowserPolicy 统一执行（三跳链路内建）

## 2. 架构总览

### 2.1 完整三跳链路

```
┌─ IPC handler ──────────────────────────────────────────────────┐
│ adapter.getBrowserRuntimeStatus(sessionId)                       │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌─ pluginBrowserMethods ─▼─────────────────────────────────────────┐
│ access.session(sessionId, { permission }).pluginId → namespace  │
│ access.client.invoke(                                            │
│   FOUNDATION_BROWSER_CAPABILITIES.RUNTIME_STATUS,                │
│   { namespace }                                                  │
│ )                                                                │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌─ CapabilityAccessController ────────────────────────────────────┐
│ grant 校验 + constraint 校验 + AbortSignal 组合 + audit 日志     │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌─ CapabilityHub.foundation ──────────────────────────────────────┐
│ FOUNDATION_BROWSER_CAPABILITIES.RUNTIME_STATUS                   │
│   ↓ browser-provider registerOwner "astravia.foundation.browser" │
│ executeBrowser(() => service.runtimeStatus(signal), signal)     │
│   ↓ mapBrowserError(BrowserAutomationError → CapabilityError)   │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌─ BrowserAutomationService ──────────────────────────────────────┐
│ runtimeStatus(signal) → 检查 runtime → 返回 BrowserRuntimeStatus  │
│ (类型唯一真源：@astravia/capability-sdk)                          │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 外部浏览器进程模型（非内嵌 WebView）

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Electron 主进程 (astravia)                            │
│                                                                          │
│  ┌──────────────────────────────────┐    ┌─────────────────────────┐   │
│  │ Plugin Capability Adapter        │    │ Capability Hub           │   │
│  │ pluginBrowserMethods (10 方法)   │───▶│ .foundation.invoke()    │   │
│  │ grant + permission 校验          │    │                         │   │
│  └──────────────────────────────────┘    │  browser-provider       │   │
│                                           │  (bindCapability ×10)   │   │
│  ┌──────────────────────────────────┐    └─────────┬───────────────┘   │
│  │ BrowserAutomationService         │              │ invoke           │
│  │  createSession / navigate / ...  │◀─────────────┘                  │
│  │  + BrowserPolicy (域名白名单)    │                                  │
│  └────────────────┬─────────────────┘                                  │
│                   │ spawn child_process                                │
│  ┌────────────────▼─────────────────┐                                  │
│  │ agent-browser CLI (Rust 原生)    │                                  │
│  │  session 管理 + Chrome 连接      │                                  │
│  │  navigate / snapshot / act       │                                  │
│  └────────────────┬─────────────────┘                                  │
└────────────────────┼────────────────────────────────────────────────────┘
                     │ CDP 协议
         ┌───────────▼───────────┐
         │   Chrome 浏览器进程    │
         │  (headed or headless)  │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │  真实浏览器窗口        │
         │  用户可见（headed 时） │
         └───────────────────────┘
```

**关键事实**：浏览器自动化**启动外部浏览器进程**（通过 agent-browser Rust CLI + CDP 协议连接），不在 Electron 内嵌 WebView 中进行。BrowserPanel（activity-panel 里的 iframe 预览面板）是独立的用户手动预览链路，与本链路完全不同。

### 2.3 目录结构

```
packages/capability-sdk/src/
  foundation/browser.ts              ← 类型唯一真源（TypeBox schema + defineCapability）
  foundation.ts                      ← 聚合导出 FOUNDATION_BROWSER_CAPABILITIES
  adapters/plugin/types.ts           ← PLUGIN_CAPABILITY_PERMISSIONS (browser.runtime.manage / browser.read / browser.interact)
  adapters/plugin/grants.ts          ← 3 权限 → 10 FOUNDATION_BROWSER_CAPABILITIES 映射
  adapters/plugin/foundation/browser.ts ← pluginBrowserMethods (10 adapter 方法)
  adapters/plugin/adapter.ts         ← Object.assign pluginBrowserMethods 进 PluginCapabilityAdapter

packages/desktop-app/src/
  main/capabilities/browser-provider.ts  ← registerDesktopBrowserProvider (10 bindCapability)
  main/capabilities/foundation-providers.ts ← 启动时注册 browser-provider
  main/browser-automation/
    browser-automation-service.ts   ← 编排入口（类型来源 capability-sdk）
    agent-browser-engine.ts         ← agent-browser CLI spawn 封装
    browser-runtime-manager.ts      ← 就绪检查 + 安装编排
    browser-policy.ts               ← 域名白名单 + allowedHosts ["*"] 全放行
    browser-session-registry.ts    ← 会话注册表 + exclusive 锁
    browser-profile-registry.ts     ← ephemeral / persistent profile 目录
    browser-process-runner.ts       ← spawn 封装 + timeout + abort
    contracts.ts                    ← BrowserEngine / SessionRecord / BrowserAutomationError
    index.ts                        ← getBrowserAutomationService() 单例入口
    *.test.ts                       ← 每文件同级单元测试
  main/ipc/plugin-capabilities.ts   ← 10 个 browser handler（调 adapter 方法）
  preload/api-types/browser.ts       ← 只 re-export capability-sdk 类型 + DesktopBrowserApi 合同
  preload/apis/browser.ts            ← createBrowserApi(ipcRenderer) 桥接实现
  renderer/domains/plugins/runtime/plugin-loader.ts ← createBrowserApi(plugin, capabilitySessionId)

packages/plugins/presets/browser/     ← 系统插件（面板 UI + Skill）
```

---

## 3. 完整能力清单

### 3.1 FOUNDATION_BROWSER_CAPABILITIES（10 个 capability token）

| Token | 输入类型 | 输出类型 | 权限 | 层 |
|---|---|---|---|---|
| RUNTIME_STATUS | `{ namespace }` | BrowserRuntimeStatus | browser.runtime.manage | query |
| RUNTIME_INSTALL | `{ namespace, step }` | BrowserRuntimeStatus | browser.runtime.manage | command |
| SESSION_CREATE | `{ namespace, source?, profile?, headed?, allowedHosts }` | BrowserSession | browser.interact | command |
| SESSION_GET | `{ namespace, sessionId }` | BrowserSession | browser.interact | query |
| SESSION_CLOSE | `{ namespace, sessionId }` | undefined | browser.interact | command |
| NAVIGATE | `{ namespace, sessionId, url }` | BrowserPageState | browser.interact | command |
| SNAPSHOT | `{ namespace, sessionId, interactiveOnly? }` | BrowserSnapshot | browser.read | query |
| READ_TEXT | `{ namespace, sessionId, maxChars? }` | BrowserTextContent | browser.read | query |
| SCREENSHOT | `{ namespace, sessionId, fullPage? }` | BrowserScreenshot | browser.read | query |
| ACT | `{ namespace, sessionId, action, snapshotRevision? }` | BrowserActionResult | browser.interact | command |

### 3.2 浏览器领域类型（唯一真源 @astravia/capability-sdk）

| 类型 | 关键字段 |
|---|---|
| BrowserSession | `{ id, source: "managed"\|"attach", profile: BrowserSessionProfile, headed, status: "ready"\|... , createdAt }` |
| BrowserSessionProfile | `{ type: "ephemeral" } \| { type: "persistent", id }` |
| BrowserRuntimeStatus | `{ phase, version?, message?, recentOutput? }` |
| BrowserPageState | `{ sessionId, revision, url, title? }` |
| BrowserSnapshot | BrowserPageState + `{ content }` |
| BrowserTextContent | BrowserPageState + `{ text, truncated }` |
| BrowserScreenshot | `{ sessionId, revision, dataUrl }` |
| BrowserActionResult | BrowserPageState + `{ output? }` |
| BrowserAction | click / fill / type / select / check / press / scroll / wait / back / reload |

### 3.3 权限 → grant 映射

| Plugin Permission | Capability Grants |
|---|---|
| `browser.runtime.manage` | RUNTIME_STATUS + RUNTIME_INSTALL |
| `browser.read` | SNAPSHOT + READ_TEXT + SCREENSHOT + SESSION_GET（只读 ownership 验证） |
| `browser.interact` | SESSION_CREATE + SESSION_GET + SESSION_CLOSE + NAVIGATE + ACT |
| `browser.profile.persist` | SESSION_CREATE（**条件**：profile.type === "persistent"） |
| `browser.attach` | SESSION_CREATE（**条件**：source === "attach"） |

每个 grant 带 NAMESPACE constraint —— plugin 只能操作自己 namespace 下的 session。

**session ownership 检查**（已实现）：
- `pluginBrowserMethods` 对所有 SESSION_GET / SESSION_CLOSE / NAVIGATE / SNAPSHOT / READ_TEXT / SCREENSHOT / ACT 调用 `assertBrowserSessionOwned(sessionId, browserSessionId)`
- createBrowserSession 成功后调 `claimBrowserSession(sessionId, created.id)`
- closeBrowserSession 成功后调 `releaseBrowserSession(sessionId, browserSessionId)`
- A plugin 不能操作 B plugin 创建的 session

**manifest allowedHosts 约束**（已实现）：
- PluginManifest.browser.allowedHosts 声明通配符列表（如 `["github.com", "*.google.com"]`）
- createBrowserSession 调 `effectiveAllowedHosts(manifestHosts, requested)` 校验：
  - 通配符规范化（`*.github.com` 展开匹配所有子域）
  - requested 不能超出 manifest 授权范围（hostGrantCovers 校验）
  - manifest 未声明 → 默认 `["*"]` 全放行（开发期宽松）
- resolver 在 PluginCapabilityAdapterOptions.resolveBrowserAllowedHosts 注入（从 InstalledPlugin.browser.allowedHosts 读取）

---

## 4. 关键组件设计

### 4.1 BrowserAutomationService（主进程编排核心）

```typescript
class BrowserAutomationService {
  // 依赖注入
  constructor(options: {
    engine: AgentBrowserEngine;
    runtime: BrowserRuntimeManager;
    profiles: BrowserProfileRegistry;
    sessions: BrowserSessionRegistry;
    logger: BrowserAutomationLogger;
  })

  // ========== 生命周期 ==========
  runtimeStatus(signal?: AbortSignal): Promise<BrowserRuntimeStatus>
  installRuntime(input: BrowserRuntimeInstallInput, signal?): Promise<BrowserRuntimeStatus>
  createSession(input: BrowserSessionCreateInput, signal?): Promise<BrowserSession>
  closeSession(input: BrowserSessionInput, signal?): Promise<void>
  closeAll(): Promise<void>

  // ========== 浏览器操作 ==========
  navigate(input: BrowserNavigateInput, signal?): Promise<BrowserPageState>
  snapshot(input: BrowserSnapshotInput, signal?): Promise<BrowserSnapshot>
  readText(input: BrowserReadTextInput, signal?): Promise<BrowserTextContent>
  screenshot(input: BrowserScreenshotInput, signal?): Promise<BrowserScreenshot>
  act(input: BrowserActInput, signal?): Promise<BrowserActionResult>
}
```

**核心不变量**：
- 每个 session 有 exclusive 锁（同 namespace + sessionId 并发操作 → 队列化）
- persistent profile 有互斥锁（同 profile.id 不能被两个会话同时占用）
- `assertAllowedBrowserUrl` 在 navigate/snapshot/act 返回时都断言（防 escape）
- snapshotRevision 防 stale（act 时比对，不一致 → 抛错 `stale_snapshot`）
- 类型来源：全部从 `@astravia/capability-sdk` 导入（唯一真源）

### 4.2 AgentBrowserEngine（agent-browser CLI 封装）

```typescript
class AgentBrowserEngine implements BrowserEngine {
  private async execute(session, command, signal?): Promise<BrowserEnginePageResult> {
    // processRunner.run("agent-browser",
    //   ["--config", session.configPath,
    //    "--session", session.id,
    //    "--pin-tab",
    //    ...command],
    //   { timeoutMs: 120_000, signal })
    //
    // 操作完成后 follow-up: get url + get title
  }
}
```

**设计要点**：
- agent-browser 启动 daemon 进程管理 Chrome 生命周期
- 每个 session 有独立 config.json（profile 目录 / headed / allowedHosts）
- `--pin-tab` 防止 tab 被关掉时静默切换到同 session 的其他 tab
- 支持 managed（由宿主创建）和 attach（连接已有 Chrome）两种 source

### 4.3 BrowserRuntimeManager（安装编排）

```typescript
class BrowserRuntimeManager {
  status(signal?): Promise<BrowserRuntimeStatus>
    // spawn("agent-browser", ["--version"])
    // 解析版本 → 比对 AGENT_BROWSER_VERSION
    // phase: ready | outdated | missing | browser-missing | error

  install(input: { step: "runtime" | "browser" }, signal?): Promise<BrowserRuntimeStatus>
    // runtime 步骤：spawn("npm", ["install", "--global", "agent-browser@0.34.0", ...])
    // browser 步骤：spawn("agent-browser", ["install"])  ← 下载 Chrome for Testing
}
```

### 4.4 BrowserProcessRunner（spawn 封装）

```typescript
interface BrowserProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
}

class BrowserProcessRunner {
  run(file: string, args: readonly string[], options: {
    timeoutMs: number;
    maxOutputChars?: number;
    signal?: AbortSignal;
  }): Promise<BrowserProcessResult>
}
```

**关键实现点**：
- spawn 继承 `process.env`（RuntimeManager.applyEnv() 已全局注入 PATH/npm_config_*）
- stdout/stderr 环形缓冲（默认 1MB，install 时 64KB 尾部）
- abort signal → kill + 抛错（AbortSignal 通过三跳链路自动传递）

### 4.5 BrowserPolicy（门禁）

```typescript
// 静态函数，无状态
function assertAllowedBrowserUrl(url, allowedHosts): string
  // allowedHosts 为 ["*"] → 全放行（测试/默认值）
  // 允许通配：*.github.com
  // 返回清理后的 URL
  // 抛错: BrowserAutomationError("policy_escape", reason)
```

---

## 5. 三跳链路详细示例

### 示例：plugin 调 `ctx.browser.runtime.status()`

```
[Renderer] plugin-sdk PluginBrowserApi.runtime.status()
  → preload DesktopBrowserApi.runtimeStatus(sessionId)
  → ipcRenderer.invoke(PLUGIN_CAPABILITY_CHANNELS.BROWSER_RUNTIME_STATUS, sessionId)

[Main IPC] plugin-capabilities.ts:
  adapter.getBrowserRuntimeStatus(requireString(sessionId, "sessionId"))

[Adapter] pluginBrowserMethods.getBrowserRuntimeStatus(sessionId):
  const session = this.session(sessionId, { permission: "browser.runtime.manage" })
  // ↑ 内部：校验 permission → 找到对应的 CapabilityAccessHandle
  //         (由 createDesktopCapabilityHost() 创建时 buildPluginCapabilityGrants() 生成)
  return session.access.client.invoke(
    FOUNDATION_BROWSER_CAPABILITIES.RUNTIME_STATUS,
    { namespace: session.pluginId }
  )

[Capability Hub] capability-hub.invoke(FOUNDATION_BROWSER_CAPABILITIES.RUNTIME_STATUS, { namespace }, context):
  // 1. 校验 grant + constraint（namespace constraint）
  // 2. combine session signal + request signal + deadline
  // 3. FOUNDATION_BROWSER_CAPABILITIES.RUNTIME_STATUS.parseInput({ namespace })
  // 4. 找到 browser-provider 注册的 owner "astravia.foundation.browser"
  // 5. 调用 bindCapability.execute(...)

[Browser Provider] browser-provider.ts:
  executeBrowser(
    () => service.runtimeStatus(context.signal),
    context.signal
  )
  // assertNotAborted → 调 service → mapBrowserError

[Service] BrowserAutomationService.runtimeStatus(signal):
  → BrowserRuntimeManager.status(signal)
  → spawn("agent-browser", ["--version"])
  → 解析版本 → BrowserRuntimeStatus { phase: "ready", version: "0.34.0" }

[回传] 反向逐层：Service → Provider → Hub → Adapter → IPC → Preload → Renderer → Plugin SDK
```

---

## 6. 与其他能力的对齐

astravia 的三跳链路**完全对齐** filesystem / storage / network / domain capabilities 的组织方式：

| 层级 | filesystem | storage | browser（新） |
|---|---|---|---|
| capability-sdk 定义 | FOUNDATION_FILESYSTEM_CAPABILITIES | FOUNDATION_STORAGE_CAPABILITIES | FOUNDATION_BROWSER_CAPABILITIES |
| grants 映射 | FILESYSTEM_READ / WRITE → 5 grants | STORAGE_READ / WRITE → 7 grants | BROWSER_RUNTIME_MANAGE / READ / INTERACT → 10 grants |
| plugin adapter | pluginFilesystemMethods | pluginStorageMethods | pluginBrowserMethods |
| desktop provider | filesystem direct in foundation-providers.ts | storage direct | **独立 browser-provider.ts** |
| IPC handler 调用 | adapter.readDirectory(sessionId) | adapter.readStorage(...) | adapter.getBrowserRuntimeStatus(sessionId) |

---

## 7. 测试覆盖

| 文件 | 测什么 | 状态 |
|---|---|---|
| contracts.test.ts | BrowserAutomationError 错误码 | ✅ 通过 |
| browser-policy.test.ts | 域名白名单 / allowedHosts / policy_escape | ✅ 通过 |
| browser-runtime-manager.test.ts | 版本比对 / install step | ✅ 通过 |
| browser-session-registry.test.ts | exclusive 锁 / persistent 互斥 | ✅ 通过 |
| browser-profile-registry.test.ts | ephemeral / persistent 目录 + 回收 | ✅ 通过 |
| agent-browser-engine.test.ts | spawn 参数拼接 / timeout / abort | ✅ 通过 |
| browser-automation-service.test.ts | 端到端编排（mock engine + runtime） | ✅ 通过 |
| browser-process-runner.test.ts | spawn 封装 + abort | ✅ 通过 |
| capability-sdk foundation.test.ts | FOUNDATION_BROWSER_CAPABILITIES.parseInput | 待补 |
| browser-provider.test.ts | mapBrowserError / AbortSignal 传递 | 待补 |
| adapter browser-permissions.test.ts | grant 校验 / namespace constraint | 待补 |

**当前 40 tests 全绿（8 个文件）**。

---

## 8. 风险与后续加固

| 项 | 状态 | 说明 |
|---|---|---|
| session ownership 检查（A plugin 关 B plugin 的 session） | ✅ 已实现 | adapter.browserSessionOwners registry + assertBrowserSessionOwned |
| manifest allowedHosts 约束 | ✅ 已实现 | effectiveAllowedHosts + hostGrantCovers；PluginManifest/InstalledPlugin 已加 browser.allowedHosts 字段；resolver 从 InstalledPlugin 读取 |
| BROWSER_PROFILE_PERSIST / BROWSER_ATTACH 细粒度权限 | ✅ 已实现 | PLUGIN_CAPABILITY_PERMISSIONS 加 2 常量；createBrowserSession 按需检查 |
| open-vetta 注释残留 | ✅ 已清理 | browser preset / plugin-sdk / runtime-controller 等 4 处残留均清 |
| browser-provider / adapter / grants 单元测试 | 待补 | 完整三跳链路的单元覆盖 |
| 插件预设测试（open-vetta 有 4 个 test 文件） | 待补 | runtime-controller.test.ts + manifest-permissions.test.ts + browser-skill.test.ts + browser-console.test.tsx |
| Skill → browser preset CLI shim | 待实现 | Skill + browser.mjs shim（原 ADR-0060 描述，当前通过三跳链路已替代） |
| Agent 端到端联调 | 待实现 | 从 Skill navigate 到真实 Chrome 的端到端验证 |
| BrowserPanel / BrowserAutomationService UI 边界明确 | ✅ 已实现 | workspace view + RuntimeSection 状态机（browser preset 完整） |

---

## 9. 工作量估算

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 能力基建 | capability-sdk TypeBox schema + grants + adapter methods | ✅ 完成 |
| P1 service + provider | BrowserAutomationService + browser-provider + foundation 注册 | ✅ 完成 |
| P2 IPC + preload | 10 IPC handlers + preload bridge + plugin-loader | ✅ 完成 |
| P3 安全加固 | session ownership / manifest host constraint / 细粒度权限 | ✅ 完成 |
| P4 面板 UI | browser preset + RuntimeSection + BrowserConsole + Skill | ✅ 完成 |
| P5 测试补全 | provider / adapter / grants / preset 单元测试 | 待做 |
| P6 端到端 | Agent → Skill → browser → Chrome 完整链路验证 | 待做 |
