import type { AssistantMessage, UserMessage } from "@astravia/ai";
import type { ContinuationPolicyContext } from "@astravia/runtime-core/kernel";
import type { CodingAgentContinuationSource } from "../../runtime-contracts/index.js";

export const DEFAULT_CODING_AGENT_LENGTH_CONTINUATION_ATTEMPTS = 3;

/**
 * Length 续接的失败码。宿主按这些码生成面向用户的本地化文案，因此它们是对外
 * 稳定的合同：改动会同时影响 Desktop 的错误卡映射（见
 * `apps/desktop/src/renderer/domains/conversation/services/classifyChatError.ts`）。
 */
export const CODING_AGENT_LENGTH_FAILURE_CODES = {
	/** 模型在产出任何可见内容之前就被判 length：没有可续接的半截结果。 */
	STOP_WITHOUT_OUTPUT: "coding_agent_length_stop_without_output",
	/** 已用满自动续接预算，模型仍然停在截断处。 */
	TRUNCATION_UNRECOVERABLE: "coding_agent_length_truncation_unrecoverable",
} as const;

/**
 * 续接策略的失败。`code` 会被 agent 运行时投影成 `turn.failed.error.code`，
 * `message` 保留上游自报的原始数据供诊断与复制，不作为用户可读文案。
 */
export class CodingAgentContinuationFailure extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = code;
		this.code = code;
	}
}

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
			throw new CodingAgentContinuationFailure(
				CODING_AGENT_LENGTH_FAILURE_CODES.STOP_WITHOUT_OUTPUT,
				`Provider reported a length stop before any visible output (reported output: ${latestAssistant.usage.output} tokens). ` +
					"Automatic continuation cannot recover this. If the reported count is far below the model's output limit, " +
					"the provider is not reporting hidden reasoning tokens or truncated the stream itself. " +
					"Try a lower thinking level, a model with a larger output limit, or splitting large file writes into several smaller ones.",
			);
		}
		if (this.attempts >= this.maxAttempts) {
			throw new CodingAgentContinuationFailure(
				CODING_AGENT_LENGTH_FAILURE_CODES.TRUNCATION_UNRECOVERABLE,
				`Model response remained truncated after ${this.maxAttempts} automatic continuation attempts`,
			);
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
