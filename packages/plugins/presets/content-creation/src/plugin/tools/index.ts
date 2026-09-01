import type { PluginContext } from "@vetta-org/plugin-sdk";
import type { ContentCreationAgentService } from "../../agent/service";
import type { ContentLocalAssetService } from "../../generation/local-asset-service";
import type { ContentRunApprovalStore } from "../run-approval";
import { registerContentExecuteTool } from "./execute";
import { registerContentSearchTool } from "./search";

export { CONTENT_EXECUTE_TOOL_NAME } from "./execute";
export { CONTENT_SEARCH_TOOL_NAME } from "./search";

export function registerContentCreationTools(
	ctx: PluginContext,
	agent: ContentCreationAgentService,
	runApprovals: ContentRunApprovalStore,
	localAssets: ContentLocalAssetService,
): void {
	registerContentSearchTool(ctx);
	registerContentExecuteTool(ctx, agent, runApprovals, localAssets);
}
