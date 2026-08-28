import type {
	CodingAgentSandboxAuthorizationDecision,
	CodingAgentSandboxAuthorizationFunctionRequest,
} from "@vetta/coding-agent/function-extensions";

export type SandboxAuthorizationHandler = (
	request: CodingAgentSandboxAuthorizationFunctionRequest,
	signal?: AbortSignal,
) => Promise<CodingAgentSandboxAuthorizationDecision>;

/** Desktop renderer 生命周期与 Coding Agent sandbox authorization function 之间的可重绑路由。 */
export class DesktopSandboxAuthorizationBroker {
	private interactiveHandler: SandboxAuthorizationHandler | undefined;

	isAvailable(): boolean {
		return this.interactiveHandler !== undefined;
	}

	readonly handle: SandboxAuthorizationHandler = (request, signal) => {
		if (signal?.aborted) return Promise.resolve("deny");
		return this.interactiveHandler?.(request, signal) ?? Promise.resolve("deny");
	};

	setInteractiveHandler(handler: SandboxAuthorizationHandler): () => void {
		this.interactiveHandler = handler;
		return () => {
			if (this.interactiveHandler === handler) this.interactiveHandler = undefined;
		};
	}
}

const sharedSandboxAuthorizationBroker = new DesktopSandboxAuthorizationBroker();

export function getDesktopSandboxAuthorizationBroker(): DesktopSandboxAuthorizationBroker {
	return sharedSandboxAuthorizationBroker;
}
