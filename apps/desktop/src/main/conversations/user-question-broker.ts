import type {
	CodingAgentQuestionFunctionRequest,
	CodingAgentQuestionResult,
} from "@vetta/coding-agent/function-extensions";

export type UserQuestionHandler = (
	request: CodingAgentQuestionFunctionRequest,
	signal?: AbortSignal,
) => Promise<CodingAgentQuestionResult>;

export interface UserQuestionResolvedEvent {
	requestId: string;
	sessionId: string;
}

type UserQuestionResolvedListener = (event: UserQuestionResolvedEvent) => void;
type UserQuestionAskedListener = (request: CodingAgentQuestionFunctionRequest) => void;

const CANCELLED_QUESTION: CodingAgentQuestionResult = { cancelled: true, answers: [] };

interface PendingQuestion {
	readonly request: CodingAgentQuestionFunctionRequest;
	/** Settles the question from outside the handler race (a paired phone answering by requestId). */
	readonly answer: (result: CodingAgentQuestionResult) => void;
}

export class DesktopUserQuestionBroker {
	private interactiveHandler: UserQuestionHandler | undefined;
	private readonly debugHandlers = new Map<string, UserQuestionHandler>();
	private readonly remoteHandlers = new Map<string, UserQuestionHandler>();
	private readonly pendingQuestions = new Map<string, PendingQuestion>();
	private readonly resolvedListeners = new Set<UserQuestionResolvedListener>();
	private readonly askedListeners = new Set<UserQuestionAskedListener>();

	readonly handle: UserQuestionHandler = async (request, signal) => {
		if (signal?.aborted) return CANCELLED_QUESTION;
		const handlers = [
			this.remoteHandlers.get(request.sessionId),
			this.debugHandlers.get(request.sessionId),
			this.interactiveHandler,
		].filter((handler): handler is UserQuestionHandler => handler !== undefined);
		if (handlers.length === 0) return CANCELLED_QUESTION;

		// Every question also races an external answer slot so a paired phone
		// can settle it by requestId without having been registered up front.
		let answerExternally: (result: CodingAgentQuestionResult) => void = () => undefined;
		const external = new Promise<CodingAgentQuestionResult>((resolve) => {
			answerExternally = resolve;
		});
		const pending: PendingQuestion = { request, answer: answerExternally };
		this.pendingQuestions.set(request.requestId, pending);
		const controllers = handlers.map(() => new AbortController());
		const abortHandlers = (): void => {
			for (const controller of controllers) controller.abort();
		};
		if (signal) signal.addEventListener("abort", abortHandlers, { once: true });
		for (const listener of this.askedListeners) listener(request);

		try {
			return await Promise.race([
				...handlers.map((handler, index) => handler(request, controllers[index].signal)),
				external,
			]);
		} finally {
			if (signal) signal.removeEventListener("abort", abortHandlers);
			abortHandlers();
			if (this.pendingQuestions.get(request.requestId) === pending) {
				this.pendingQuestions.delete(request.requestId);
			}
			const event = { requestId: request.requestId, sessionId: request.sessionId };
			for (const listener of this.resolvedListeners) listener(event);
		}
	};

	/** Settles a pending question from outside the handler race; false when it is unknown or already settled. */
	answer(requestId: string, result: CodingAgentQuestionResult): boolean {
		const pending = this.pendingQuestions.get(requestId);
		if (!pending) return false;
		this.pendingQuestions.delete(requestId);
		pending.answer(result);
		return true;
	}

	onQuestionAsked(listener: UserQuestionAskedListener): () => void {
		this.askedListeners.add(listener);
		return () => this.askedListeners.delete(listener);
	}

	isAvailable(): boolean {
		return this.interactiveHandler !== undefined || this.debugHandlers.size > 0 || this.remoteHandlers.size > 0;
	}

	listPendingQuestions(): CodingAgentQuestionFunctionRequest[] {
		return [...this.pendingQuestions.values()].map((pending) => pending.request);
	}

	registerRemoteHandler(sessionId: string, handler: UserQuestionHandler): () => void {
		if (this.remoteHandlers.has(sessionId)) {
			throw new Error(`A remote question handler is already registered for session ${sessionId}.`);
		}
		this.remoteHandlers.set(sessionId, handler);
		return () => {
			if (this.remoteHandlers.get(sessionId) === handler) this.remoteHandlers.delete(sessionId);
		};
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
