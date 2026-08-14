/** Structured system-prompt document and deterministic mutation/rendering operations. */

export type SystemPromptBlockType =
	| "subconscious"
	| "base"
	| "tools"
	| "mcp"
	| "guidelines"
	| "append"
	| "context"
	| "memory"
	| "skills"
	| "mode"
	| "personalization"
	| "footer"
	| "plugin";

export interface SystemPromptBlock {
	id: string;
	type: SystemPromptBlockType;
	source: {
		kind: "core" | "plugin";
		pluginId?: string;
	};
	content: string;
	priority: number;
	enabled: boolean;
}

export interface SystemPromptDraft {
	blocks: SystemPromptBlock[];
	metadata: {
		cwd: string;
		dateTime: string;
		promptBudgetTokens?: number;
	};
}

export interface SystemPromptBlockDiagnostics {
	readonly id: string;
	readonly type: SystemPromptBlockType;
	readonly source: SystemPromptBlock["source"];
	readonly charCount: number;
	readonly estimatedTokens: number;
}

export interface SystemPromptDiagnostics {
	readonly charCount: number;
	readonly estimatedTokens: number;
	readonly enabledBlockCount: number;
	readonly promptBudgetTokens?: number;
	readonly overBudget: boolean;
	readonly blocks: readonly SystemPromptBlockDiagnostics[];
}

/**
 * 稳定段与易变段的 priority 分界。
 *
 * 分界以下的块（subconscious/base/mcp/guidelines/append/context/memory/skills）在会话内基本不变，
 * 可以作为 Provider 前缀缓存的命中段；分界及以上的块（mode 850 / personalization 900 / footer 1000）
 * 随会话设置与日期变化，放在缓存断点之后。
 */
export const STABLE_SYSTEM_PROMPT_PRIORITY = 800;

export interface CompiledSystemPrompt {
	readonly content: string;
	/**
	 * `content` 中稳定前缀的字符长度，满足 `content.slice(0, stableLength)` 恰好等于
	 * 所有 `priority < STABLE_SYSTEM_PROMPT_PRIORITY` 的启用块按同一顺序 join("\n\n") 的结果。
	 *
	 * 块间分隔符 `"\n\n"` 归属其后的块，因此两段都非空时 `content.slice(stableLength)` 以 `"\n\n"` 开头，
	 * 两段拼回必然等于 `content`。全部块落在同一段时取 `content.length` 或 `0`。
	 */
	readonly stableLength: number;
	readonly diagnostics: SystemPromptDiagnostics;
}

export type SystemPromptBlockPatch = Partial<Omit<SystemPromptBlock, "id" | "source">>;

export type SystemPromptOperation =
	| { type: "addBlock"; block: SystemPromptBlock }
	| { type: "replaceBlock"; blockId: string; block: SystemPromptBlock }
	| { type: "updateBlock"; blockId: string; patch: SystemPromptBlockPatch }
	| { type: "removeBlock"; blockId: string }
	| { type: "setBlockEnabled"; blockId: string; enabled: boolean };

export interface SystemPromptContribution {
	pluginId: string;
	operations: SystemPromptOperation[];
}

export function coreBlock(
	id: string,
	type: SystemPromptBlockType,
	content: string,
	priority: number,
): SystemPromptBlock {
	return {
		id,
		type,
		source: { kind: "core" },
		content,
		priority,
		enabled: content.length > 0,
	};
}

export function applySystemPromptOperation(
	draft: SystemPromptDraft,
	pluginId: string,
	operation: SystemPromptOperation,
): void {
	assertSystemPromptDraft(draft);
	switch (operation.type) {
		case "addBlock": {
			assertPluginBlockIdAvailable(draft, operation.block.id);
			draft.blocks.push({
				...operation.block,
				source: { kind: "plugin", pluginId },
			});
			return;
		}
		case "replaceBlock": {
			const index = draft.blocks.findIndex((block) => block.id === operation.blockId);
			if (index < 0 && isCoreBlockId(operation.blockId)) {
				throw new Error(`Cannot replace missing core system prompt block: ${operation.blockId}`);
			}
			const nextBlock: SystemPromptBlock = {
				...operation.block,
				id: operation.blockId,
				source: { kind: "plugin", pluginId },
			};
			if (index >= 0) {
				draft.blocks[index] = nextBlock;
			} else {
				draft.blocks.push(nextBlock);
			}
			return;
		}
		case "updateBlock": {
			const block = draft.blocks.find((candidate) => candidate.id === operation.blockId);
			if (block) {
				const { type, content, priority, enabled } = operation.patch;
				if (type !== undefined) block.type = type;
				if (content !== undefined) block.content = content;
				if (priority !== undefined) block.priority = priority;
				if (enabled !== undefined) block.enabled = enabled;
			}
			return;
		}
		case "removeBlock":
			draft.blocks = draft.blocks.filter((block) => block.id !== operation.blockId);
			return;
		case "setBlockEnabled": {
			const block = draft.blocks.find((candidate) => candidate.id === operation.blockId);
			if (block) {
				block.enabled = operation.enabled;
			}
			return;
		}
	}
}

export function applySystemPromptOperations(
	draft: SystemPromptDraft,
	pluginId: string,
	operations: readonly SystemPromptOperation[],
): SystemPromptDraft {
	const nextDraft: SystemPromptDraft = {
		blocks: draft.blocks.map((block) => ({ ...block, source: { ...block.source } })),
		metadata: { ...draft.metadata },
	};
	for (const operation of operations) {
		applySystemPromptOperation(nextDraft, pluginId, operation);
	}
	assertSystemPromptDraft(nextDraft);
	return nextDraft;
}

export function compileSystemPromptDraft(draft: SystemPromptDraft): CompiledSystemPrompt {
	assertSystemPromptDraft(draft);
	const enabledBlocks = draft.blocks
		.filter((block) => block.enabled && block.content.length > 0)
		.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
	const content = enabledBlocks.map((block) => block.content).join("\n\n");
	// 排序保证稳定段是 enabledBlocks 的前缀，因此对稳定段单独 join 的长度就是 content 的切分点。
	const stableLength = enabledBlocks
		.filter((block) => block.priority < STABLE_SYSTEM_PROMPT_PRIORITY)
		.map((block) => block.content)
		.join("\n\n").length;
	const estimatedTokens = estimateTextTokens(content);
	return {
		content,
		stableLength,
		diagnostics: {
			charCount: content.length,
			estimatedTokens,
			enabledBlockCount: enabledBlocks.length,
			promptBudgetTokens: draft.metadata.promptBudgetTokens,
			overBudget:
				draft.metadata.promptBudgetTokens !== undefined && estimatedTokens > draft.metadata.promptBudgetTokens,
			blocks: enabledBlocks.map((block) => ({
				id: block.id,
				type: block.type,
				source: { ...block.source },
				charCount: block.content.length,
				estimatedTokens: estimateTextTokens(block.content),
			})),
		},
	};
}

export function renderSystemPromptDraft(draft: SystemPromptDraft): string {
	return compileSystemPromptDraft(draft).content;
}

export function assertSystemPromptDraft(draft: SystemPromptDraft): void {
	if (
		draft.metadata.promptBudgetTokens !== undefined &&
		(!Number.isFinite(draft.metadata.promptBudgetTokens) || draft.metadata.promptBudgetTokens <= 0)
	) {
		throw new Error("System prompt token budget must be a positive finite number");
	}
	const ids = new Set<string>();
	for (const block of draft.blocks) {
		if (!block.id.trim()) throw new Error("System prompt block id cannot be empty");
		if (ids.has(block.id)) throw new Error(`Duplicate system prompt block id: ${block.id}`);
		if (!Number.isFinite(block.priority)) {
			throw new Error(`System prompt block priority must be finite: ${block.id}`);
		}
		if (block.source.kind === "core") {
			if (!isCoreBlockId(block.id) || block.source.pluginId !== undefined) {
				throw new Error(`Invalid core system prompt block provenance: ${block.id}`);
			}
		} else if (!block.source.pluginId?.trim()) {
			throw new Error(`Plugin system prompt block is missing pluginId: ${block.id}`);
		}
		ids.add(block.id);
	}
}

function estimateTextTokens(content: string): number {
	return Math.ceil(content.length / 4);
}

function assertPluginBlockIdAvailable(draft: SystemPromptDraft, blockId: string): void {
	if (isCoreBlockId(blockId)) throw new Error(`Plugin cannot add reserved core system prompt block: ${blockId}`);
	if (draft.blocks.some(({ id }) => id === blockId)) {
		throw new Error(`Duplicate system prompt block id: ${blockId}`);
	}
}

function isCoreBlockId(blockId: string): boolean {
	return blockId.startsWith("core.");
}
