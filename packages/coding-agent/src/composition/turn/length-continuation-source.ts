import type { AssistantMessage, UserMessage } from "@vetta/ai";
import type { ContinuationPolicyContext } from "@vetta/runtime-core/kernel";
import type { CodingAgentContinuationSource } from "../../runtime-contracts/index.js";

export const DEFAULT_CODING_AGENT_LENGTH_CONTINUATION_ATTEMPTS = 3;

export interface CodingAgentLengthContinuationSourceOptions {
	readonly now?: () => number;
	readonly maxAttempts?: number;
}

/** 在模型输出预算耗尽时，自动请求模型从截断位置继续回答。 */
export class CodingAgentLengthContinuationSource implements CodingAgentContinuationSource {
	readonly id = "model-length";
	readonly priority = -100;

	private readonly now: () => number;
	private readonly maxAttempts: number;
	private activeTurnId: string | undefined;
	private attempts = 0;

	constructor(options: CodingAgentLengthContinuationSourceOptions = {}) {
		this.now = options.now ?? Date.now;
		this.maxAttempts = options.maxAttempts ?? DEFAULT_CODING_AGENT_LENGTH_CONTINUATION_ATTEMPTS;
		if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1) {
			throw new Error("Length continuation maxAttempts must be a positive integer");
		}
	}

	async collect(context: ContinuationPolicyContext): Promise<readonly UserMessage[]> {
		if (this.activeTurnId !== context.turnId) {
			this.activeTurnId = context.turnId;
			this.attempts = 0;
		}
		if (context.signal.aborted) return [];

		const latestAssistant = [...context.messages]
			.reverse()
			.find((message): message is AssistantMessage => message.role === "assistant");
		if (latestAssistant?.stopReason !== "length") return [];
		if (this.attempts >= this.maxAttempts) {
			throw new Error(`Model response remained truncated after ${this.maxAttempts} automatic continuation attempts`);
		}

		this.attempts += 1;
		return [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Continue the response from where you stopped. Do not repeat content already provided.",
					},
				],
				timestamp: this.now(),
			},
		];
	}
}
