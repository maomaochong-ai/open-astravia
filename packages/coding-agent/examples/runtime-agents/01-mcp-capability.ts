import { type Static, Type } from "@sinclair/typebox";
import {
	defineRuntimeAgent,
	type RuntimeAgentDefinition,
	type RuntimeAgentSessionPlan,
	RuntimeHost,
} from "@vetta/runtime-core";
import {
	type AgentFeatureDefinition,
	createDefaultRuntimeCapabilityDefinition,
	type ModelCallContribution,
	type ModelCallContributionProvider,
	type RuntimeToolDefinition,
} from "@vetta/runtime-core/kernel";
import {
	createMcpRuntimeToolSynchronizer,
	type McpRuntimeToolBinding,
	type McpRuntimeToolSource,
	type McpRuntimeToolSynchronizer,
	renderMcpToolsInstruction,
} from "@vetta/runtime-mcp";
import { acquirePreview, executeTextTool } from "./support/preview.js";

const CatalogSearchInputSchema = Type.Object({ query: Type.String() }, { additionalProperties: false });
type CatalogSearchInput = Static<typeof CatalogSearchInputSchema>;

/** 示例 Source 模拟平台宿主提供的 stdio/HTTP MCP 连接视图。 */
export class MutableMcpToolSource implements McpRuntimeToolSource {
	private bindings: readonly McpRuntimeToolBinding[] = [];

	replace(bindings: readonly McpRuntimeToolBinding[]): void {
		this.bindings = [...bindings];
	}

	async refresh() {
		return { tools: [...this.bindings] };
	}
}

export interface McpCapabilityExampleResult {
	readonly firstTurn: {
		readonly toolNames: readonly string[];
		readonly prompt: string;
		readonly execution: string;
	};
	readonly inFlightAfterSourceUpdate: { readonly toolNames: readonly string[]; readonly execution: string };
	readonly nextTurn: {
		readonly toolNames: readonly string[];
		readonly prompt: string;
		readonly execution: string;
	};
}

/**
 * MCP Source 在 Session Plan admission 刷新；Feature 的 bindForTurn 再捕获不可变工具视图。
 * 真实宿主只需替换 Source，不应把 transport、凭证或 Client 放入 Agent Definition。
 */
export function createMcpResearchAgent(source: McpRuntimeToolSource): RuntimeAgentDefinition {
	return defineRuntimeAgent({
		id: "mcp-researcher",
		createInstance: () => ({
			prepareSession: () => {
				const tools = new Map<string, RuntimeToolDefinition>();
				const synchronizer = createMcpRuntimeToolSynchronizer(source, {
					register: (tool) => tools.set(tool.name, tool),
					unregister: (toolName) => tools.delete(toolName),
				});
				const plan: RuntimeAgentSessionPlan = {
					definition: {
						capabilities: createDefaultRuntimeCapabilityDefinition({
							instructions: [
								{
									id: "mcp-researcher.base",
									content: "Use the available catalog tools to gather evidence.",
									priority: 0,
								},
							],
							features: [createMcpFeature(synchronizer)],
							toolPolicy: { authorize: async () => true },
						}),
					},
					async beforeSnapshotAcquire(context) {
						context?.signal.throwIfAborted();
						await synchronizer.refresh();
					},
					dispose: () => synchronizer.dispose(),
				};
				return plan;
			},
		}),
	});
}

export async function runMcpCapabilityExample(): Promise<McpCapabilityExampleResult> {
	const source = new MutableMcpToolSource();
	source.replace([mcpBinding(catalogTool("catalog-v1", "Search the v1 catalog"), "catalog-v1")]);
	const host = new RuntimeHost();

	try {
		host.agents.registry.upsert({
			source: { id: "example", revision: "mcp-1" },
			definition: createMcpResearchAgent(source),
		});
		const instance = await host.agents.createInstance({
			agentId: "mcp-researcher",
			instanceId: "mcp-researcher-instance",
		});
		const session = await instance.createSession({ sessionId: "mcp-researcher-session" });
		const first = await acquirePreview(session, "mcp-turn-1");
		try {
			const firstTool = requireTool(first.frame.tools, "mcp_catalog_search");
			const firstExecution = await executeTextTool(firstTool, { query: "leases" }, session.id, "mcp-turn-1");

			source.replace([
				mcpBinding(catalogTool("catalog-v2", "Search the v2 catalog"), "catalog-v2"),
				mcpBinding(changelogTool(), "changelog-v1"),
			]);
			const next = await acquirePreview(session, "mcp-turn-2");
			try {
				const nextTool = requireTool(next.frame.tools, "mcp_catalog_search");
				return {
					firstTurn: {
						toolNames: [...first.frame.tools.keys()],
						prompt: readInstruction(first.frame.instructions, "mcp.tools"),
						execution: firstExecution,
					},
					inFlightAfterSourceUpdate: {
						toolNames: [...first.frame.tools.keys()],
						execution: await executeTextTool(firstTool, { query: "snapshots" }, session.id, "mcp-turn-1"),
					},
					nextTurn: {
						toolNames: [...next.frame.tools.keys()],
						prompt: readInstruction(next.frame.instructions, "mcp.tools"),
						execution: await executeTextTool(nextTool, { query: "rollout" }, session.id, "mcp-turn-2"),
					},
				};
			} finally {
				await next.lease.release();
			}
		} finally {
			await first.lease.release();
		}
	} finally {
		await host.close();
	}
}

function createMcpFeature(synchronizer: McpRuntimeToolSynchronizer): AgentFeatureDefinition {
	const capture = (): ModelCallContribution => {
		const snapshot = synchronizer.snapshot();
		const content = renderMcpToolsInstruction(snapshot.tools, false);
		return {
			instructions: content ? [{ id: "mcp.tools", content, priority: 500 }] : [],
			tools: synchronizer.view().tools.map(({ tool }) => tool),
		};
	};
	const provider: ModelCallContributionProvider = {
		id: "example.mcp-tools",
		bindForTurn: () => {
			const contribution = capture();
			return {
				id: "example.mcp-tools.bound",
				async contribute({ signal }) {
					signal.throwIfAborted();
					return contribution;
				},
			};
		},
		async contribute({ signal }) {
			signal.throwIfAborted();
			return capture();
		},
	};
	return {
		id: "example.mcp-tools",
		async prepare({ signal }) {
			signal.throwIfAborted();
			return {
				async contribute() {
					return { modelCallProviders: [provider] };
				},
				async dispose() {},
			};
		},
	};
}

function catalogTool(version: string, description: string): RuntimeToolDefinition<CatalogSearchInput> {
	return {
		name: "mcp_catalog_search",
		label: "Catalog search",
		description,
		inputSchema: CatalogSearchInputSchema,
		async execute({ input, signal }) {
			signal.throwIfAborted();
			return { content: [{ type: "text", text: `${version}:${input.query}` }] };
		},
	};
}

function changelogTool(): RuntimeToolDefinition {
	return {
		name: "mcp_changelog_read",
		label: "Changelog reader",
		description: "Read catalog changelog entries",
		inputSchema: Type.Object({}, { additionalProperties: false }),
		async execute() {
			return { content: [{ type: "text", text: "changelog-v1" }] };
		},
	};
}

function mcpBinding(tool: RuntimeToolDefinition, fingerprint: string): McpRuntimeToolBinding {
	return { tool, fingerprint, serverName: "example-catalog" };
}

function requireTool(tools: ReadonlyMap<string, RuntimeToolDefinition>, name: string): RuntimeToolDefinition {
	const tool = tools.get(name);
	if (!tool) throw new Error(`Expected example tool: ${name}`);
	return tool;
}

function readInstruction(
	instructions: readonly { readonly id: string; readonly content: string }[],
	id: string,
): string {
	return instructions.find((instruction) => instruction.id === id)?.content ?? "";
}
