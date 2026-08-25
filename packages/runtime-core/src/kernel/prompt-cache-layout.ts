import type { InstructionBlock, InstructionCacheability, ModelCallFrame } from "./contracts.js";

export interface CompiledPromptCacheLayout {
	readonly systemPromptStableLength: number;
	readonly promptCacheSystemPromptBlocks: NonNullable<ModelCallFrame["promptCacheSystemPromptBlocks"]>;
}

export interface SanitizedPromptCacheLayout {
	readonly systemPromptStableLength?: number;
	readonly promptCacheSystemPromptBlocks?: ModelCallFrame["promptCacheSystemPromptBlocks"];
	readonly degraded: boolean;
	readonly degradationReason?: "invalid-stable-length" | "invalid-block-layout";
}

/**
 * 在不重排 Instruction 的前提下计算开头连续稳定区。块间分隔符归属其后的块，
 * 因此首个 volatile block 及其前导分隔符都不会进入稳定前缀。
 */
export function compilePromptCacheLayout(
	instructions: readonly InstructionBlock[],
	defaultCacheability: (instruction: InstructionBlock) => InstructionCacheability,
): CompiledPromptCacheLayout {
	const visibleInstructions = instructions.filter(({ content }) => content.length > 0);
	let blockEnd = 0;
	let stableLength = 0;
	let volatileReached = false;
	const blocks = visibleInstructions.map((instruction, index) => {
		const start = blockEnd + (index === 0 ? 0 : 2);
		blockEnd = start + instruction.content.length;
		const declaredCacheability = instruction.cacheability ?? defaultCacheability(instruction);
		if (declaredCacheability === "volatile") volatileReached = true;
		const cacheability = volatileReached ? "volatile" : "stable";
		if (!volatileReached) stableLength = blockEnd;
		return Object.freeze({
			id: instruction.id,
			start,
			length: instruction.content.length,
			cacheability,
		});
	});
	return Object.freeze({
		systemPromptStableLength: stableLength,
		promptCacheSystemPromptBlocks: Object.freeze(blocks),
	});
}

/** 缓存元数据是优化信息；非法 Composer 输出保守降级为不缓存，而不是破坏模型调用。 */
export function sanitizePromptCacheLayout(
	instructions: readonly InstructionBlock[],
	systemPromptStableLength: number | undefined,
	blocks: ModelCallFrame["promptCacheSystemPromptBlocks"],
): SanitizedPromptCacheLayout {
	if (systemPromptStableLength === undefined && blocks === undefined) return Object.freeze({ degraded: false });
	const promptLength = composedPromptLength(instructions);
	if (
		systemPromptStableLength !== undefined &&
		(!Number.isInteger(systemPromptStableLength) ||
			systemPromptStableLength < 0 ||
			systemPromptStableLength > promptLength)
	) {
		return Object.freeze({
			systemPromptStableLength: 0,
			degraded: true,
			degradationReason: "invalid-stable-length",
		});
	}
	if (blocks !== undefined && !areValidBlockSpans(blocks, promptLength, systemPromptStableLength)) {
		return Object.freeze({
			systemPromptStableLength: 0,
			degraded: true,
			degradationReason: "invalid-block-layout",
		});
	}
	return Object.freeze({
		...(systemPromptStableLength !== undefined ? { systemPromptStableLength } : {}),
		...(blocks
			? { promptCacheSystemPromptBlocks: Object.freeze(blocks.map((block) => Object.freeze({ ...block }))) }
			: {}),
		degraded: false,
	});
}

function composedPromptLength(instructions: readonly InstructionBlock[]): number {
	const lengths = instructions.filter(({ content }) => content.length > 0).map(({ content }) => content.length);
	return lengths.reduce((total, length) => total + length, Math.max(0, lengths.length - 1) * 2);
}

function areValidBlockSpans(
	blocks: NonNullable<ModelCallFrame["promptCacheSystemPromptBlocks"]>,
	promptLength: number,
	stableLength: number | undefined,
): boolean {
	const ids = new Set<string>();
	let previousEnd = 0;
	let volatileReached = false;
	for (const block of blocks) {
		const end = block.start + block.length;
		if (
			!block.id ||
			ids.has(block.id) ||
			!Number.isInteger(block.start) ||
			!Number.isInteger(block.length) ||
			block.start < previousEnd ||
			block.length < 0 ||
			end > promptLength
		) {
			return false;
		}
		if (block.cacheability === "volatile") volatileReached = true;
		if (volatileReached && block.cacheability === "stable") return false;
		if (stableLength !== undefined) {
			if (block.cacheability === "stable" && end > stableLength) return false;
			if (block.cacheability === "volatile" && block.start < stableLength) return false;
		}
		ids.add(block.id);
		previousEnd = end;
	}
	return true;
}
