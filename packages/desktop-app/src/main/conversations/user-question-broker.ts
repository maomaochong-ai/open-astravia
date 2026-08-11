import type { RuntimeUserQuestionRequest, RuntimeUserQuestionResult } from "@vetta/runtime-core";

type UserQuestionHandler = (
	request: RuntimeUserQuestionRequest,
	signal?: AbortSignal,
) => Promise<RuntimeUserQuestionResult>;

export interface UserQuestionResolvedEvent {
	requestId: string;
	sessionId: string;
}

type UserQuestionResolvedListener = (event: UserQuestionResolvedEvent) => void;

const CANCELLED_QUESTION: RuntimeUserQuestionResult = { cancelled: true, answers: [] };

export class DesktopUserQuestionBroker {
	private interactiveHandler: UserQuestionHandler | undefined;
	private readonly debugHandlers = new Map<string, UserQuestionHandler>();
	private readonly pendingQuestions = new Map<string, RuntimeUserQuestionRequest>();
	private readonly resolvedListeners = new Set<UserQuestionResolvedListener>();

	readonly handle: UserQuestionHandler = async (request, signal) => {
		if (signal?.aborted) return CANCELLED_QUESTION;
		const handlers = [this.debugHandlers.get(request.sessionId), this.interactiveHandler].filter(
			(handler): handler is UserQuestionHandler => handler !== undefined,
		);
		if (handlers.length === 0) return CANCELLED_QUESTION;

		this.pendingQuestions.set(request.requestId, request);
		const controllers = handlers.length > 1 ? handlers.map(() => new AbortController()) : undefined;
		const abortHandlers = (): void => {
			for (const controller of controllers ?? []) controller.abort();
		};
		if (signal && controllers) signal.addEventListener("abort", abortHandlers, { once: true });

		try {
			if (!controllers) return await handlers[0](request, signal);
			return await Promise.race(handlers.map((handler, index) => handler(request, controllers[index].signal)));
		} finally {
			if (signal && controllers) signal.removeEventListener("abort", abortHandlers);
			abortHandlers();
			if (this.pendingQuestions.get(request.requestId) === request) {
				this.pendingQuestions.delete(request.requestId);
			}
			const event = { requestId: request.requestId, sessionId: request.sessionId };
			for (const listener of this.resolvedListeners) listener(event);
		}
	};

	listPendingQuestions(): RuntimeUserQuestionRequest[] {
		return [...this.pendingQuestions.values()];
	}

	onQuestionResolved(listener: UserQuestionResolvedListener): () => void {
		this.resolvedListeners.add(listener);
		return () => this.resolvedListeners.delete(listener);
	}

	setInteractiveHandler(handler: UserQuestionHandler): () => void {
		this.interactiveHandler = handler;
		return () => {
			if (this.interactiveHandler === handler) this.interactiveHandler = undefined;
		};
	}

	registerDebugHandler(sessionId: string, handler: UserQuestionHandler): () => void {
		if (this.debugHandlers.has(sessionId)) {
			throw new Error(`A debug question handler is already registered for session ${sessionId}.`);
		}
		this.debugHandlers.set(sessionId, handler);
		return () => {
			if (this.debugHandlers.get(sessionId) === handler) this.debugHandlers.delete(sessionId);
		};
	}
}

const sharedUserQuestionBroker = new DesktopUserQuestionBroker();

export function getDesktopUserQuestionBroker(): DesktopUserQuestionBroker {
	return sharedUserQuestionBroker;
}
