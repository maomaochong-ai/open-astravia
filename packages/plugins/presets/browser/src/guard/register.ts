import type { PluginContext } from "@vetta-org/plugin-sdk";
import { type BrowserGuardConfig, GUARDED_HOST_TOOL_NAMES, evaluateBrowserToolCall } from "./policy";

/**
 * 把门禁挂到 Coding Agent 的 PreToolUse 上。
 *
 * `toolNames` 精确列出要拦的工具，而不是拦全部再在 handler 里过滤：hook 每次触发都要往
 * renderer 打一次 IPC，全量订阅会给所有工具（包括 bash、编辑）平白加一跳延迟。
 *
 * 配置是**每次调用现读**而不是注册时快照：用户在设置页改完白名单，下一次工具调用就该生效，
 * 不该等到重开会话。
 */
export function registerBrowserGuard(ctx: PluginContext, readConfig: () => BrowserGuardConfig): void {
	ctx.agent.registerHook({
		id: "browser-action-guard",
		eventName: "PreToolUse",
		// fail-closed：只在真正会用到浏览器的交互场景生效。批量与知识库加工是非交互后台
		// 场景，那里没有用户能去改白名单，拦下来也无人可问。
		scope_use: ["conversation", "project", "im-claw", "automation"],
		toolNames: GUARDED_HOST_TOOL_NAMES,
		timeoutMs: 3_000,
		handler({ event }) {
			const decision = evaluateBrowserToolCall(event.tool.hostName, event.toolInput, readConfig());
			return decision.action === "block" ? { action: "block", reason: decision.reason } : { action: "continue" };
		},
	});
}

