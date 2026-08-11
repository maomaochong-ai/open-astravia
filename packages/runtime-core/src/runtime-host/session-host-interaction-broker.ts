import type { RuntimeSandboxGrantDecision, RuntimeSandboxGrantRequest } from "../contracts.js";
import type { RuntimeSessionHostInteraction, RuntimeSessionHostInteractionContext } from "./session-ports.js";

/**
 * 可重新绑定的 Session-local 宿主交互代理。
 *
 * 工具只持有本对象，不闭包某次 Desktop/CLI Handler；Session 尚未绑定宿主时默认拒绝。
 */
export class RuntimeSessionHostInteractionBroker
	implements RuntimeSessionHostInteraction, RuntimeSessionHostInteractionContext
{
	private context: RuntimeSessionHostInteractionContext | undefined;

	bind(context: RuntimeSessionHostInteractionContext): Promise<void> {
		this.context = context;
		return Promise.resolve();
	}

	confirm(title: string, message: string, signal?: AbortSignal): Promise<boolean> {
		if (signal?.aborted) return Promise.resolve(false);
		return this.context?.confirm(title, message, signal) ?? Promise.resolve(false);
	}

	requestSandboxGrant(
		request: Omit<RuntimeSandboxGrantRequest, "requestId" | "sessionId">,
	): Promise<RuntimeSandboxGrantDecision> {
		return this.context?.requestSandboxGrant(request) ?? Promise.resolve("deny");
	}
}
