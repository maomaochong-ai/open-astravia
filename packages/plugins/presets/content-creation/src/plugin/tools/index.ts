import type { PluginContext } from "@vetta-org/plugin-sdk";
import type { ContentCreationAgentService } from "../../agent/service";
import type { ContentLocalAssetService } from "../../generation/local-asset-service";
import type { ContentRunApprovalStore } from "../run-approval";
import { registerContentAssetsTool } from "./assets";
import { registerContentEditTool } from "./edit";
import { registerContentInspectTool } from "./inspect";
import { registerContentRunTool } from "./run";

export { CONTENT_ASSETS_TOOL_NAME } from "./assets";
export { CONTENT_EDIT_TOOL_NAME } from "./edit";
export { CONTENT_INSPECT_TOOL_NAME } from "./inspect";
export { CONTENT_RUN_TOOL_NAME } from "./run";

export function registerContentCreationTools(
	ctx: PluginContext,
	agent: ContentCreationAgentService,
	runApprovals: ContentRunApprovalStore,
	localAssets: ContentLocalAssetService,
): void {
	registerContentInspectTool(ctx, agent);
	registerContentAssetsTool(ctx, localAssets);
	registerContentEditTool(ctx, agent);
	registerContentRunTool(ctx, agent, runApprovals);
}
