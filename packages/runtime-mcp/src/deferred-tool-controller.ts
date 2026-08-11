import type { AgentFeatureDefinition, InstructionBlock, ModelCallContribution } from "@vetta/runtime-core/kernel";
import { createMcpToolSearchRuntimeTool, scoreMcpDeferredTools } from "./deferred-tool-search.js";
import { renderMcpToolsInstruction } from "./mcp-prompt.js";
import type { McpRuntimeToolDescriptor, McpRuntimeToolSnapshot } from "./runtime-tool-synchronizer.js";

export const DEFAULT_MCP_DEFERRED_THRESHOLD = 15;

export interface McpDeferredToolControllerOptions {
	readonly sessionId: string;
	readonly deferredEnabled?: boolean;
	readonly threshold?: number;
	readonly explicitToolNames?: ReadonlySet<string>;
}

export interface McpDeferredFeatureOptions {
	readonly includePromptInstruction?: boolean;
}

export interface McpDeferredPromptState {
	readonly tools: readonly McpRuntimeToolDescriptor[];
	readonly deferred: boolean;
}

/**
 * 保存单个 Session 的 MCP 渐进披露状态。
 *
 * MCP 连接和注册表由 synchronizer 共享；已激活工具名只属于当前 Session。
 * 已删除工具的激活记录故意保留，以兼容旧运行时中“同名工具重新出现后恢复可见”的行为。
 */
export class McpDeferredToolController {
	private readonly activatedToolNames = new Set<string>();
	private readonly deferredEnabled: boolean;
	private readonly explicitToolNames: ReadonlySet<string> | undefined;
	private readonly threshold: number;
	private currentSnapshot: McpRuntimeToolSnapshot = Object.freeze({
		revision: 0,
		tools: Object.freeze([]),
	});

	constructor(private readonly options: McpDeferredToolControllerOptions) {
		this.deferredEnabled = options.deferredEnabled ?? true;
		this.explicitToolNames = options.explicitToolNames;
		this.threshold = options.threshold ?? DEFAULT_MCP_DEFERRED_THRESHOLD;
	}

	refresh(snapshot: McpRuntimeToolSnapshot): void {
		this.currentSnapshot = snapshot;
	}

	isDeferred(): boolean {
		return this.deferredEnabled && this.currentSnapshot.tools.length > this.threshold;
	}

	isManagedTool(toolName: string): boolean {
		return this.currentSnapshot.tools.some(({ name }) => name === toolName);
	}

	isToolVisible(toolName: string): boolean {
		if (!this.isManagedTool(toolName)) return false;
		if (this.isDeferred()) return this.activatedToolNames.has(toolName);
		return this.explicitToolNames?.has(toolName) ?? true;
	}

	readPromptState(): McpDeferredPromptState {
		return {
			tools: this.instructionTools(),
			deferred: this.isDeferred(),
		};
	}

	createFeature(options: McpDeferredFeatureOptions = {}): AgentFeatureDefinition {
		const controller = this;
		const toolSearch = createMcpToolSearchRuntimeTool((query, maxResults) => this.search(query, maxResults));
		return {
			id: "mcp-progressive-disclosure",
			async prepare() {
				return {
					async contribute() {
						return {
							modelCallProviders: [
								{
									id: "mcp-progressive-disclosure",
									contribute: async (context) => {
										context.signal.throwIfAborted();
										if (context.sessionId !== controller.options.sessionId) return {};
										return controller.contribute(toolSearch, options.includePromptInstruction ?? true);
									},
								},
							],
						};
					},
					async dispose() {},
				};
			},
		};
	}

	private contribute(
		toolSearch: ReturnType<typeof createMcpToolSearchRuntimeTool>,
		includePromptInstruction: boolean,
	): ModelCallContribution {
		const tools = this.instructionTools();
		const instruction = includePromptInstruction ? this.createInstruction(tools) : undefined;
		return {
			instructions: instruction ? [instruction] : [],
			tools: this.isDeferred() ? [toolSearch] : [],
		};
	}

	private createInstruction(tools: readonly McpRuntimeToolDescriptor[]): InstructionBlock | undefined {
		const content = renderMcpToolsInstruction(tools, this.isDeferred());
		if (content.length === 0) return undefined;
		return {
			id: "mcp.tools",
			content,
			priority: 500,
		};
	}

	private instructionTools(): readonly McpRuntimeToolDescriptor[] {
		if (this.isDeferred() || !this.explicitToolNames) return this.currentSnapshot.tools;
		return this.currentSnapshot.tools.filter(({ name }) => this.explicitToolNames?.has(name));
	}

	private search(query: string, maxResults: number) {
		const matches = scoreMcpDeferredTools(query, this.currentSnapshot.tools).slice(0, maxResults);
		const activated: McpRuntimeToolDescriptor[] = [];
		const alreadyActive: string[] = [];
		for (const match of matches) {
			if (this.activatedToolNames.has(match.name)) {
				alreadyActive.push(match.name);
				continue;
			}
			this.activatedToolNames.add(match.name);
			activated.push(match);
		}
		return {
			activated,
			alreadyActive,
			totalDeferred: this.currentSnapshot.tools.length,
		};
	}
}

export function createMcpDeferredToolController(options: McpDeferredToolControllerOptions): McpDeferredToolController {
	return new McpDeferredToolController(options);
}
