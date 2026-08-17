import type { PluginContext } from "@vetta-org/plugin-sdk";
import type { ContentLocalAssetService } from "../../generation/local-asset-service";
import {
	CONTENT_PROJECT_DIR_PROPERTY,
	CONTENT_REVISION_PROPERTY,
	CONTENT_TOOL_SCOPE_USE,
	CONTENT_WORKSPACE_TAB_ID,
	type ContentProjectInput,
	resolveContentProjectCwd,
} from "./shared";
import { contentCreationToolError } from "./tool-error";

export const CONTENT_ASSETS_TOOL_NAME = "content_creation_assets";

const CONTENT_ASSETS_TOOL_DESCRIPTION = `
Bring user-supplied local image, video, or audio files into the content-creation workflow. Use only paths supplied by the user or host, and list a directory before importing selected media.

Importing copies files into managed plugin storage and returns stable asset and generation-source IDs. Do not use this tool for ordinary repository files or already-managed or generated media; use normal file tools or content_creation_inspect instead.

No confirmation is required.
`.trim();

interface AssetsInput extends ContentProjectInput {
	action: "list" | "import";
	paths: string[];
	recursive?: boolean;
	directoryMode?: "select-one" | "all";
	assetNodeId?: string;
	expectedRevision?: number;
	nodeName?: string;
	nodePurpose?: string;
}

export function registerContentAssetsTool(ctx: PluginContext, localAssets: ContentLocalAssetService): void {
	ctx.agent.registerTool<AssetsInput>({
		id: "manage-content-creation-assets",
		name: CONTENT_ASSETS_TOOL_NAME,
		label: "%tool.assets.label%",
		description: CONTENT_ASSETS_TOOL_DESCRIPTION,
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["list", "import"],
					description:
						"list discovers eligible media without changing the project; import copies explicitly selected media into managed storage and creates or updates an asset node.",
				},
				projectDir: CONTENT_PROJECT_DIR_PROPERTY,
				paths: {
					type: "array",
					minItems: 1,
					items: { type: "string", minLength: 1 },
					description: "Absolute file or directory paths supplied by the user or host file context.",
				},
				recursive: { type: "boolean", description: "Include nested directories. Defaults to false." },
				directoryMode: {
					type: "string",
					enum: ["select-one", "all"],
					description: "Import all directory media only when explicitly requested; defaults to select-one.",
				},
				assetNodeId: { type: "string", description: "Existing asset node to receive imported media." },
				expectedRevision: CONTENT_REVISION_PROPERTY,
				nodeName: { type: "string", description: "Name for an automatically created asset node." },
				nodePurpose: { type: "string", description: "Semantic purpose for an automatically created asset node." },
			},
			required: ["action", "paths"],
			additionalProperties: false,
		},
		scope_use: CONTENT_TOOL_SCOPE_USE,
		handler: async ({ session, trigger }) => {
			try {
				if (trigger.input.action === "list") {
					const candidates = await localAssets.list(trigger.input.paths, trigger.input.recursive);
					return { ok: true, status: "listed", count: candidates.length, candidates };
				}
				const imported = await localAssets.import({
					projectDir: resolveContentProjectCwd(trigger.input, session.cwd),
					paths: trigger.input.paths,
					recursive: trigger.input.recursive,
					directoryMode: trigger.input.directoryMode,
					targetNodeId: trigger.input.assetNodeId,
					expectedRevision: trigger.input.expectedRevision,
					nodeName: trigger.input.nodeName,
					nodePurpose: trigger.input.nodePurpose,
				});
				ctx.ui.openActivityTab(CONTENT_WORKSPACE_TAB_ID, { width: "max" });
				const generationSources = imported.assets.map(({ id, kind }) => ({
					sourceNodeId: imported.assetNodeId,
					assetIds: [id],
					kind,
				}));
				return {
					ok: true,
					status: "imported",
					projectId: imported.project.projectId,
					revision: imported.project.revision,
					assetNodeId: imported.assetNodeId,
					assets: imported.assets.map(({ id, name, kind, mimeType }) => ({ id, name, kind, mimeType })),
					generationSources,
					...(generationSources.length === 1 ? { generationSource: generationSources[0] } : {}),
				};
			} catch (error) {
				return contentCreationToolError(error);
			}
		},
	});
}
