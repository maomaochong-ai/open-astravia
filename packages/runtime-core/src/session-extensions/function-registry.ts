import type { SessionExtensionFunctionSource, SessionExtensionFunctionToken } from "./contracts.js";

type SessionExtensionFunctionHandler = (input: unknown, signal: AbortSignal) => Promise<unknown> | unknown;

interface RegisteredFunction {
	readonly handler: SessionExtensionFunctionHandler;
}

export class SessionExtensionFunctionUnavailableError extends Error {
	readonly functionId: string;

	constructor(functionId: string) {
		super(`Session extension function is not registered: ${functionId}`);
		this.name = "SessionExtensionFunctionUnavailableError";
		this.functionId = functionId;
	}
}

/**
 * Composition Root 持有的动态 typed function 注册表。
 *
 * invoke 在开始时捕获当前 binding；随后注销只影响新调用，不中断已经开始的工作。
 */
export class SessionExtensionFunctionRegistry implements SessionExtensionFunctionSource {
	private readonly functions = new Map<string, RegisteredFunction>();
	private closed = false;

	register<Input, Output>(
		token: SessionExtensionFunctionToken<Input, Output>,
		handler: (input: Input, signal: AbortSignal) => Promise<Output> | Output,
	): () => void {
		this.assertOpen();
		if (this.functions.has(token.id)) {
			throw new Error(`Session extension function is already registered: ${token.id}`);
		}
		const registration: RegisteredFunction = {
			handler: handler as SessionExtensionFunctionHandler,
		};
		this.functions.set(token.id, registration);
		return () => {
			if (this.functions.get(token.id) === registration) this.functions.delete(token.id);
		};
	}

	has<Input, Output>(token: SessionExtensionFunctionToken<Input, Output>): boolean {
		return !this.closed && this.functions.has(token.id);
	}

	async invoke<Input, Output>(
		token: SessionExtensionFunctionToken<Input, Output>,
		input: Input,
		signal: AbortSignal = new AbortController().signal,
	): Promise<Output> {
		this.assertOpen();
		signal.throwIfAborted();
		const registration = this.functions.get(token.id);
		if (!registration) throw new SessionExtensionFunctionUnavailableError(token.id);
		return (await registration.handler(input, signal)) as Output;
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.functions.clear();
	}

	private assertOpen(): void {
		if (this.closed) throw new Error("Session extension function registry is closed");
	}
}
