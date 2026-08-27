import type {
	RuntimeQuestionItem,
	RuntimeSandboxGrantDecision,
	RuntimeSandboxGrantInfo,
	RuntimeSandboxGrantRequest,
	RuntimeUserConfirmationRequest,
	RuntimeUserQuestionRequest,
	RuntimeUserQuestionResult,
} from "../contracts.js";
import { createRuntimeId } from "../id-generator.js";
import type { RuntimeSessionAskUserQuestionCapability } from "./session-backend.js";
import type { RuntimeSessionHostInteractionContext } from "./session-ports.js";
import type { RuntimeSandboxGrantStore } from "./session-services.js";

export interface RuntimeHostInteractionsOptions {
	readonly sandboxGrantStore?: RuntimeSandboxGrantStore;
	readonly readCanonicalSessionId: (sessionId: string) => string;
	readonly userConfirmationHandler?: (
		request: RuntimeUserConfirmationRequest,
		signal?: AbortSignal,
	) => Promise<boolean>;
	readonly userQuestionHandler?: (
		request: RuntimeUserQuestionRequest,
		signal?: AbortSignal,
	) => Promise<RuntimeUserQuestionResult>;
	readonly userSandboxGrantHandler?: (
		request: RuntimeSandboxGrantRequest,
		signal?: AbortSignal,
	) => Promise<RuntimeSandboxGrantDecision>;
}

/** Mutable host-interaction bindings shared by all active Runtime Sessions. */
export class RuntimeHostInteractions {
	private userConfirmationHandler: RuntimeHostInteractionsOptions["userConfirmationHandler"];
	private userQuestionHandler: RuntimeHostInteractionsOptions["userQuestionHandler"];
	private userSandboxGrantHandler: RuntimeHostInteractionsOptions["userSandboxGrantHandler"];

	constructor(private readonly options: RuntimeHostInteractionsOptions) {
		this.userConfirmationHandler = options.userConfirmationHandler;
		this.userQuestionHandler = options.userQuestionHandler;
		this.userSandboxGrantHandler = options.userSandboxGrantHandler;
	}

	setUserConfirmationHandler(handler: RuntimeHostInteractionsOptions["userConfirmationHandler"]): void {
		this.userConfirmationHandler = handler;
	}

	setUserQuestionHandler(handler: RuntimeHostInteractionsOptions["userQuestionHandler"]): void {
		this.userQuestionHandler = handler;
	}

	setUserSandboxGrantHandler(handler: RuntimeHostInteractionsOptions["userSandboxGrantHandler"]): void {
		this.userSandboxGrantHandler = handler;
	}

	listSandboxGrants(sessionId: string): RuntimeSandboxGrantInfo[] {
		return [...(this.options.sandboxGrantStore?.list(this.options.readCanonicalSessionId(sessionId)) ?? [])];
	}

	revokeSandboxGrant(sessionId: string, grantId: string): boolean {
		return this.options.sandboxGrantStore?.revoke(this.options.readCanonicalSessionId(sessionId), grantId) ?? false;
	}

	revokeAllSandboxGrants(sessionId: string): number {
		return this.options.sandboxGrantStore?.revokeAll(this.options.readCanonicalSessionId(sessionId)) ?? 0;
	}

	createAskUserQuestionCapability(
		enabled: boolean,
		sessionIdRef: { current?: string },
	): RuntimeSessionAskUserQuestionCapability | undefined {
		if (!enabled) return undefined;
		return {
			isEnabled: () => this.userQuestionHandler != null,
			ask: async (
				request: { questions: RuntimeQuestionItem[] },
				signal?: AbortSignal,
			): Promise<RuntimeUserQuestionResult> => {
				const handler = this.userQuestionHandler;
				if (!handler || signal?.aborted) return { cancelled: true, answers: [] };
				return handler(
					{
						requestId: createRuntimeId(),
						sessionId: sessionIdRef.current ?? "",
						questions: request.questions,
					},
					signal,
				);
			},
		};
	}

	createContext(sessionIdRef: { current?: string }): RuntimeSessionHostInteractionContext {
		return {
			confirm: async (title, message, signal) => {
				const handler = this.userConfirmationHandler;
				if (!handler || signal?.aborted) return false;
				return handler(
					{
						requestId: createRuntimeId(),
						sessionId: sessionIdRef.current ?? "",
						title,
						message,
					},
					signal,
				);
			},
			requestSandboxGrant: async (request) => {
				const handler = this.userSandboxGrantHandler;
				if (!handler) return "deny";
				return handler({
					requestId: createRuntimeId(),
					sessionId: sessionIdRef.current ?? "",
					title: request.title,
					message: request.message,
					toolName: request.toolName,
					capability: request.capability,
					target: request.target,
					resolvedTarget: request.resolvedTarget,
					grantRoot: request.grantRoot,
					command: request.command,
					sensitive: request.sensitive,
				});
			},
		};
	}
}
