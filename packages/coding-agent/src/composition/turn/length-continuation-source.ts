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
		if (latestAssistant?.stopReason !== "length") {
			// 模型已经能正常收尾：偶发截断不应在同一个 Turn 内累积到判死。
			this.attempts = 0;
			return [];
		}
		if (!hasVisibleOutput(latestAssistant)) {
			// 正文一个 token 都没产出就被判 length：无处可续接，重来一遍只会再被截断。
			// 报出上游自报的输出量——它常常远小于模型上限，因为这类网关既不上报隐藏的
			// 推理 token，也会在参数流式输出中途被截断时整块丢掉未完成的工具调用。
			throw new Error(
				`Provider reported a length stop before any visible output (reported output: ${latestAssistant.usage.output} tokens). ` +
					"Automatic continuation cannot recover this. If the reported count is far below the model's output limit, " +
					"the provider is not reporting hidden reasoning tokens or truncated the stream itself. " +
					"Try a lower thinking level, a model with a larger output limit, or splitting large file writes into several smaller ones.",
			);
		}
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

/** thinking 不是可续接的正文：只有正文或工具调用才说明模型确实产出了半截结果。 */
function hasVisibleOutput(message: AssistantMessage): boolean {
	return message.content.some(
		(part) => part.type === "toolCall" || (part.type === "text" && part.text.trim().length > 0),
	);
}
