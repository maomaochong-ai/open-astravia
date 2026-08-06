import type { ImageContent } from "@vetta/ai";
import type { GreenfieldRuntimeSession } from "@vetta/runtime-core";
import type { CodingAgentGreenfieldTurnRetryControllerPort } from "./greenfield-turn-retry-controller.js";

export interface CodingAgentGreenfieldTurnSessionHost {
	startActiveSessionOperation<T>(operation: (session: GreenfieldRuntimeSession) => Promise<T>): Promise<T>;
}

export interface CodingAgentGreenfieldTurnCommandHost {
	throwIfExtensionCommand(text: string): void;
	tryExecute(text: string): Promise<boolean>;
}

export interface CodingAgentGreenfieldTurnExecutorOptions {
	readonly sessionHost: CodingAgentGreenfieldTurnSessionHost;
	readonly retryController: CodingAgentGreenfieldTurnRetryControllerPort;
	readonly commandHost?: CodingAgentGreenfieldTurnCommandHost;
}

export interface CodingAgentGreenfieldTurnPromptOptions {
	readonly images?: readonly ImageContent[];
	readonly streamingBehavior?: "steer" | "followUp";
	readonly throwOnFailure?: boolean;
}

/** Prompt、Extension command、continue 与 retry 的中立 Turn 编排入口。 */
export class CodingAgentGreenfieldTurnExecutor {
	constructor(private readonly options: CodingAgentGreenfieldTurnExecutorOptions) {}

	async prompt(message: string, promptOptions: CodingAgentGreenfieldTurnPromptOptions = {}): Promise<void> {
		if (!promptOptions.streamingBehavior) {
			const executed = await this.options.sessionHost.startActiveSessionOperation(
				async () => this.options.commandHost?.tryExecute(message) ?? false,
			);
			if (executed) return;
		} else {
			this.options.commandHost?.throwIfExtensionCommand(message);
		}

		const executeInitial = () =>
			this.options.sessionHost.startActiveSessionOperation((session) =>
				session.prompt({
					text: message,
					images: promptOptions.images ? [...promptOptions.images] : undefined,
					streamingBehavior: promptOptions.streamingBehavior,
				}),
			);
		const result = await this.options.retryController.run(
			executeInitial,
			() => this.options.sessionHost.startActiveSessionOperation((session) => session.retry()),
			readGreenfieldFailedTurnMessage,
		);
		const failedMessage = readGreenfieldFailedTurnMessage(result);
		if (failedMessage && promptOptions.throwOnFailure !== false) throw new Error(failedMessage);
	}
}

export function readGreenfieldFailedTurnMessage(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const error = Reflect.get(value, "error");
	if (
		Reflect.get(value, "status") === "failed" &&
		typeof error === "object" &&
		error !== null &&
		typeof Reflect.get(error, "message") === "string"
	) {
		return Reflect.get(error, "message");
	}
	if (Reflect.get(value, "status") !== "completed" || Reflect.get(value, "stopReason") !== "error") {
		return undefined;
	}
	const messages = Reflect.get(value, "messages");
	if (!Array.isArray(messages)) return "Request failed";
	let assistant: unknown;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const candidate: unknown = messages[index];
		if (
			typeof candidate === "object" &&
			candidate !== null &&
			Reflect.get(candidate, "role") === "assistant" &&
			Reflect.get(candidate, "stopReason") === "error"
		) {
			assistant = candidate;
			break;
		}
	}
	const message = assistant ? Reflect.get(assistant, "errorMessage") : undefined;
	return typeof message === "string" && message.length > 0 ? message : "Request failed";
}
