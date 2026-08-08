import type { Message } from "@vetta/ai";
import type {
	CodingAgentModelCallFailureRecovery,
	CodingAgentModelCallFailureRecoveryInput,
	CodingAgentModelCallFailureRecoveryResult,
} from "./contracts.js";

export const IMAGE_RETRY_OMITTED_PLACEHOLDER = "[image omitted after the model rejected the image request]";

const IMAGE_REQUEST_FAILURE_PATTERN =
	/\b413\b|request entity too large|payload too large|invalid.{0,40}image|image.{0,40}(invalid|too large|unsupported|decode|dimension|format)/i;

export class CodingAgentImageRequestFailureRecovery implements CodingAgentModelCallFailureRecovery {
	async recover(
		input: CodingAgentModelCallFailureRecoveryInput,
		signal: AbortSignal,
	): Promise<CodingAgentModelCallFailureRecoveryResult | undefined> {
		signal.throwIfAborted();
		if (input.recoveryAttempt !== 0) return undefined;
		const errorMessage = input.assistantMessage.errorMessage;
		if (
			input.assistantMessage.stopReason !== "error" ||
			!errorMessage ||
			!IMAGE_REQUEST_FAILURE_PATTERN.test(errorMessage)
		) {
			return undefined;
		}
		const messages = removeRejectedAssistant(input.messages, input.assistantMessage);
		const stripped = stripModelInputImages(messages);
		return stripped.changed ? { messages: stripped.messages } : undefined;
	}
}

export function stripModelInputImages(messages: readonly Message[]): {
	readonly messages: readonly Message[];
	readonly changed: boolean;
} {
	let changed = false;
	const projected = messages.map((message) => {
		if (message.role !== "user" && message.role !== "toolResult") return message;
		if (!Array.isArray(message.content) || !message.content.some((item) => item.type === "image")) return message;
		changed = true;
		return {
			...message,
			content: message.content.flatMap((item) =>
				item.type === "image" ? [{ type: "text" as const, text: IMAGE_RETRY_OMITTED_PLACEHOLDER }] : [item],
			),
		};
	});
	return { messages: changed ? projected : messages, changed };
}

export function hasImageRetryPlaceholder(messages: readonly Message[]): boolean {
	return messages.some(
		(message) =>
			Array.isArray(message.content) &&
			message.content.some((item) => item.type === "text" && item.text === IMAGE_RETRY_OMITTED_PLACEHOLDER),
	);
}

function removeRejectedAssistant(
	messages: readonly Message[],
	assistantMessage: CodingAgentModelCallFailureRecoveryInput["assistantMessage"],
): readonly Message[] {
	return messages.filter((message) => message !== assistantMessage);
}
