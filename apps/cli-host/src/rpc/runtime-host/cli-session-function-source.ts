import { CODING_AGENT_TOOL_CONSENT_FUNCTION } from "@vetta/coding-agent/function-extensions";
import {
	SessionExtensionFunctionRegistry,
	type SessionExtensionFunctionSource,
} from "@vetta/runtime-core/session-extensions";

const IM_HOST_AUTHORIZED_HEAVY_TOOLS = new Set(["im_send_attachment"]);

export interface CliCodingAgentFunctionSource {
	readonly source: SessionExtensionFunctionSource;
	dispose(): void;
}

/**
 * CLI 宿主的产品策略适配器。
 *
 * IM Host Bridge 由最终宿主显式启用，并且只授予它实际承载的附件外发能力；这不是 Runtime
 * 的交互概念，也不把任意 heavy Tool 视为已授权。其余工具继续由 Coding Agent 的 heavy
 * policy fail closed。
 */
export function createCliImHostFunctionSource(): CliCodingAgentFunctionSource {
	const registry = new SessionExtensionFunctionRegistry();
	registry.register(CODING_AGENT_TOOL_CONSENT_FUNCTION, ({ toolName }) =>
		IM_HOST_AUTHORIZED_HEAVY_TOOLS.has(toolName) ? "allow_session" : "deny",
	);
	return {
		source: registry,
		dispose: () => registry.close(),
	};
}
