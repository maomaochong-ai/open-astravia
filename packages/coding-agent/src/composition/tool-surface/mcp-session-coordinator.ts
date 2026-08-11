import type { RuntimeResourceContext } from "@vetta/runtime-core";
import {
	createMcpDeferredToolController,
	createMcpRuntimeToolSynchronizer,
	type McpDeferredToolController,
	type McpRuntimeToolRegistry,
	type McpRuntimeToolSnapshot,
	type McpRuntimeToolSource,
	type McpRuntimeToolView,
} from "@vetta/runtime-mcp";
import type { CodingToolActivation } from "@vetta/runtime-tools/coding";
import type { CodingAgentPluginMcpRuntime } from "../../runtime-contracts/index.js";
import type { CodingAgentSessionMarkerIndex, CodingAgentSessionValueIndex } from "../session-lifecycle/indexes.js";

export interface CodingAgentMcpSessionIndexes {
	readonly pluginMcpRuntimes: CodingAgentSessionValueIndex<CodingAgentPluginMcpRuntime>;
	readonly resourceContexts: CodingAgentSessionValueIndex<RuntimeResourceContext>;
	readonly mcpControllers: CodingAgentSessionValueIndex<McpDeferredToolController>;
	readonly mcpRefreshObservedSessions: CodingAgentSessionMarkerIndex;
	readonly mcpPromptRefreshReuseSessions: CodingAgentSessionMarkerIndex;
}

export interface CodingAgentMcpSessionCoordinatorOptions {
	readonly source?: McpRuntimeToolSource;
	readonly registry: McpRuntimeToolRegistry;
	readonly indexes: CodingAgentMcpSessionIndexes;
}

export interface CodingAgentMcpSessionControllerOptions {
	readonly sessionId: string;
	readonly activation: CodingToolActivation;
	readonly pluginRuntime?: CodingAgentPluginMcpRuntime;
}

export interface CodingAgentMcpSessionCoordinator {
	readonly sharedRuntimeAvailable: boolean;
	createSessionController(options: CodingAgentMcpSessionControllerOptions): McpDeferredToolController | undefined;
	refreshCatalogForModelCall(sessionId: string): Promise<void>;
	refreshSession(sessionId: string, reportPromptBoundary: boolean): Promise<McpRuntimeToolSnapshot | undefined>;
	readInheritedToolView(pluginRuntime?: CodingAgentPluginMcpRuntime): Promise<McpRuntimeToolView>;
	dispose(): void;
}

/** 组合共享 MCP、Session Plugin MCP、渐进披露状态与模型调用边界刷新。 */
export async function createCodingAgentMcpSessionCoordinator(
	options: CodingAgentMcpSessionCoordinatorOptions,
): Promise<CodingAgentMcpSessionCoordinator> {
	const synchronizer = options.source ? createMcpRuntimeToolSynchronizer(options.source, options.registry) : undefined;
	try {
		await synchronizer?.refresh();
	} catch (error) {
		synchronizer?.dispose();
		throw error;
	}

	const refreshSession = async (
		sessionId: string,
		reportPromptBoundary: boolean,
	): Promise<McpRuntimeToolSnapshot | undefined> => {
		const pluginRuntime = options.indexes.pluginMcpRuntimes.get(sessionId);
		const resourceContext = options.indexes.resourceContexts.get(sessionId);
		const firstPromptRefresh = reportPromptBoundary && !options.indexes.mcpRefreshObservedSessions.has(sessionId);
		const before = mergeMcpSnapshots(synchronizer?.snapshot(), pluginRuntime?.snapshot());
		let startReported = false;
		if (firstPromptRefresh && resourceContext) {
			await resourceContext.reportObservation({ type: "mcp.reload.start", source: "agent" });
			startReported = true;
		}
		try {
			const baseSnapshot = await synchronizer?.refresh();
			const pluginSnapshot = await pluginRuntime?.refresh();
			const snapshot = mergeMcpSnapshots(baseSnapshot, pluginSnapshot);
			if (snapshot) options.indexes.mcpControllers.get(sessionId)?.refresh(snapshot);
			const changed = snapshot?.revision !== before?.revision;
			if (reportPromptBoundary && (firstPromptRefresh || changed) && resourceContext) {
				if (!startReported) {
					await resourceContext.reportObservation({ type: "mcp.reload.start", source: "agent" });
				}
				await resourceContext.reportObservation({ type: "mcp.reload.end", changed, source: "agent" });
			}
			if (reportPromptBoundary) options.indexes.mcpRefreshObservedSessions.add(sessionId);
			if (reportPromptBoundary) options.indexes.mcpPromptRefreshReuseSessions.add(sessionId);
			return snapshot;
		} catch (error) {
			if (reportPromptBoundary && resourceContext) {
				if (!startReported) {
					await resourceContext.reportObservation({ type: "mcp.reload.start", source: "agent" });
				}
				await resourceContext.reportObservation({
					type: "mcp.reload.end",
					changed: false,
					errorMessage: error instanceof Error ? error.message : String(error),
					source: "agent",
				});
			}
			throw error;
		}
	};

	return {
		sharedRuntimeAvailable: synchronizer !== undefined,
		createSessionController(controllerOptions) {
			if (!synchronizer && !controllerOptions.pluginRuntime) return undefined;
			const controller = createMcpDeferredToolController({
				sessionId: controllerOptions.sessionId,
				deferredEnabled: controllerOptions.activation.mode !== "explicit",
				explicitToolNames:
					controllerOptions.activation.mode === "explicit"
						? new Set(controllerOptions.activation.toolNames)
						: undefined,
			});
			const snapshot = mergeMcpSnapshots(synchronizer?.snapshot(), controllerOptions.pluginRuntime?.snapshot());
			if (snapshot) controller.refresh(snapshot);
			return controller;
		},
		async refreshCatalogForModelCall(sessionId) {
			if (options.indexes.mcpPromptRefreshReuseSessions.delete(sessionId)) return;
			await refreshSession(sessionId, false);
		},
		refreshSession,
		async readInheritedToolView(pluginRuntime) {
			await synchronizer?.refresh();
			await pluginRuntime?.refresh();
			return mergeMcpToolViews(synchronizer?.view(), pluginRuntime?.view());
		},
		dispose() {
			synchronizer?.dispose();
		},
	};
}

function mergeMcpSnapshots(
	base: McpRuntimeToolSnapshot | undefined,
	overlay: McpRuntimeToolSnapshot | undefined,
): McpRuntimeToolSnapshot | undefined {
	if (!base && !overlay) return undefined;
	const tools = new Map<string, McpRuntimeToolSnapshot["tools"][number]>();
	for (const tool of base?.tools ?? []) tools.set(tool.name, tool);
	for (const tool of overlay?.tools ?? []) tools.set(tool.name, tool);
	return Object.freeze({
		revision: (base?.revision ?? 0) + (overlay?.revision ?? 0),
		tools: Object.freeze([...tools.values()]),
	});
}

function mergeMcpToolViews(
	base: McpRuntimeToolView | undefined,
	overlay: McpRuntimeToolView | undefined,
): McpRuntimeToolView {
	if (!base && !overlay) return EMPTY_MCP_TOOL_VIEW;
	const tools = new Map<string, McpRuntimeToolView["tools"][number]>();
	for (const binding of base?.tools ?? []) tools.set(binding.tool.name, binding);
	for (const binding of overlay?.tools ?? []) tools.set(binding.tool.name, binding);
	return Object.freeze({ tools: Object.freeze([...tools.values()]) });
}

const EMPTY_MCP_TOOL_VIEW: McpRuntimeToolView = Object.freeze({ tools: Object.freeze([]) });
