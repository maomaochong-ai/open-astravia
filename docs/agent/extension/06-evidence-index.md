# 证据索引

本页列出评审使用的主要事实源。Vetta 链接指向当前仓库，Pi 链接固定到评审 SHA `936aff00918de1187f085f123c2812d8f2d67745`。

## Vetta：架构与公开合同

- [`coding-agent` 重写边界与规则](../../../packages/coding-agent/AGENTS.md)
- [`coding-agent` 包说明](../../../packages/coding-agent/README.md)
- [Coding Agent 架构索引](../coding-agent/README.md)
- [Runtime composition options](../../../packages/coding-agent/src/composition/contracts/runtime-composition-options.ts)
- [公开 SDK create contract](../../../packages/coding-agent/src/public-api/sdk/sdk-create-contract.ts)
- [公开 SDK session contract](../../../packages/coding-agent/src/public-api/sdk/sdk-session-contract.ts)
- [动态 resource source contract](../../../packages/coding-agent/src/public-api/sdk/sdk-resource-source-contract.ts)
- [`coding-agent` package exports](../../../packages/coding-agent/package.json)
- [RPC 模式合同](../../../packages/coding-agent/docs/rpc.md)
- [保留 Pi `0.14.2`/`pi-mono` 环境信息的历史 fixture](../../../packages/coding-agent/test/fixtures/before-compaction.jsonl)

## Vetta：Coding Extension

- [Extension API contract](../../../packages/coding-agent/src/extensions/api-contracts.ts)
- [Extension context contract](../../../packages/coding-agent/src/extensions/context-contracts.ts)
- [Tool contract](../../../packages/coding-agent/src/extensions/tool-contracts.ts)
- [Extension event union](../../../packages/coding-agent/src/extensions/events/index.ts)
- [Extension registration](../../../packages/coding-agent/src/extensions/runtime/registration/extension-registration.ts)
- [Extension module loader](../../../packages/coding-agent/src/extensions/runtime/loading/extension-module-loader.ts)
- [Extension context host](../../../packages/coding-agent/src/extensions/runtime/context/extension-context-host.ts)
- [Extension runner](../../../packages/coding-agent/src/extensions/runtime/extension-runner.ts)
- [Extension event bus](../../../packages/coding-agent/src/extensions/runtime/event-bus.ts)
- [Extension registry](../../../packages/coding-agent/src/extensions/runtime/registry/extension-registry.ts)
- [Host Extension compatibility contracts](../../../packages/coding-agent/src/host/extensions/compatibility/contracts.ts)
- [Host Extension compatibility resolver](../../../packages/coding-agent/src/host/extensions/compatibility/resolver.ts)
- [Session resource runtime](../../../packages/coding-agent/src/resources/runtime/session-resource-runtime.ts)
- [Package `pi` resource manifest discovery](../../../packages/coding-agent/src/resources/packages/resource-discovery.ts)
- [Resource package lifecycle](../../../packages/coding-agent/src/resources/packages/package-lifecycle.ts)
- [Resource package source parsing](../../../packages/coding-agent/src/resources/packages/source-spec.ts)
- [动态 Skill/Extension source tests](../../../packages/coding-agent/test/sdk/coding-agent-sdk-dynamic-resources.test.ts)

## Vetta：Runtime

- [`runtime-core` README](../../../packages/runtime-core/README.md)
- [`runtime-tools` README](../../../packages/runtime-tools/README.md)
- [Dynamic tool registry](../../../packages/runtime-tools/src/coding/coding-tool-catalog.ts)
- [`runtime-mcp` README](../../../packages/runtime-mcp/README.md)
- [MCP runtime tool synchronizer](../../../packages/runtime-mcp/src/runtime-tool-synchronizer.ts)
- [`runtime-subagents` README](../../../packages/runtime-subagents/README.md)
- [Subagent recovery](../../../packages/runtime-subagents/src/recovery.ts)
- [`runtime-storage` README](../../../packages/runtime-storage/README.md)
- [`runtime-telemetry` README](../../../packages/runtime-telemetry/README.md)

## Vetta：Plugin、权限与宿主

- [Plugin 总览](../../plugin/README.md)
- [Plugin manifest](../../plugin/manifest.md)
- [Plugin permissions](../../plugin/permissions.md)
- [Conversation 与 Agent Plugin API](../../plugin/conversation-and-agent.md)
- [ADR-0023：受信 Renderer Plugin](../../adr/0023-plugins-trusted-in-renderer-no-sandbox.md)
- [Capability 架构](../../capabilities/README.md)
- [Capability catalog](../../capabilities/catalog.md)
- [Plugin SDK context](../../../packages/plugins/plugin-sdk/src/context.ts)
- [Plugin SDK agent API](../../../packages/plugins/plugin-sdk/src/agent.ts)
- [Agent Plugin tool runtime](../../../packages/coding-agent/src/plugins/runtime/tool-runtime.ts)
- [Agent Plugin run orchestrator](../../../packages/coding-agent/src/plugins/runtime/run-orchestrator.ts)

## Pi：产品、Extension 与 Package

- [Pi coding-agent README](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/README.md)
- [Extension 文档](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/docs/extensions.md)
- [Extension examples](https://github.com/earendil-works/pi/tree/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/examples/extensions)
- [Extension types](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/src/core/extensions/types.ts)
- [Extension runner](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/src/core/extensions/runner.ts)
- [Extension loader](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/src/core/extensions/loader.ts)
- [Pi coding-agent package dependencies](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/package.json)
- [Agent session runtime](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/src/core/agent-session-runtime.ts)
- [Resource loader](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/src/core/resource-loader.ts)
- [Package manager](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/src/core/package-manager.ts)
- [Project trust](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/src/core/project-trust.ts)
- [SDK 文档](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/docs/sdk.md)
- [Pi coding-agent changelog](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/CHANGELOG.md)
- [Pi agent changelog](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/agent/CHANGELOG.md)
- [Session context replacement regression](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/test/suite/regressions/2860-replaced-session-context.test.ts)
- [Event bus lifecycle regression](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/test/suite/regressions/7193-event-bus-lifecycle.test.ts)
- [Extension factory cache tests](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/test/suite/regressions/extension-factory-cache.test.ts)

## Pi：实验性远程协议

- [Protocol README](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/protocol/README.md)
- [Protocol schemas](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/protocol/src/schemas.ts)
- [Client README](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/client/README.md)
- [Server README](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/server/README.md)

## Pi：AgentHarness v2 设计与完成状态

- [Harness v2 design](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/agent/docs/harness-v2.md)
- [Harness v2 state machine](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/agent/docs/harness-v2-state-machine.md)
- [Harness v2 test matrix](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/agent/docs/harness-v2-test-matrix.md)
- [AgentHarness scaffold](https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/agent/src/harness/agent-harness.ts)

## 可重复核对方法

```powershell
# Vetta 固定点
git rev-parse HEAD
git show -s --format='%H%n%cI%n%s' HEAD

# Pi 固定点（在上游 clone 中）
git rev-parse HEAD
git show -s --format='%H%n%cI%n%s' HEAD
git show v0.14.2:packages/coding-agent/package.json
```

若后续要更新评审，应先修改[版本基线](01-scope-and-baseline.md#固定版本)，再逐项复核评分、时间线、采纳状态和固定 SHA 链接，不要只把 URL 中的 commit 替换为新值。
