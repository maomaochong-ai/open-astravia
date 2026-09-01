import type { PluginContext } from "@vetta-org/plugin-sdk";
import type { ContentLocalAssetService } from "../../generation/local-asset-service";
import {
	CONTENT_PROJECT_DIR_PROPERTY,
	CONTENT_REVISION_PROPERTY,
	CONTENT_WORKSPACE_TAB_ID,
	type ContentProjectInput,
	resolveContentProjectCwd,
} from "./shared";
import { contentCreationToolError } from "./tool-error";

export const CONTENT_ASSETS_OPERATION_DESCRIPTION = `
Bring user-supplied local image, video, or audio files into the content-creation workflow. Use only paths supplied by the user or host, and list a directory before importing selected media.

Importing copies files into managed plugin storage and returns stable asset and generation-source IDs. Do not use this operation for ordinary repository files or already-managed or generated media; use normal file tools or inspect instead.

No confirmation is required.
`.trim();

export interface AssetsInput extends ContentProjectInput {
	action: "list" | "import";
	paths: string[];
	recursive?: boolean;
	directoryMode?: "select-one" | "all";
	assetNodeId?: string;
	expectedRevision?: number;
	nodeName?: string;
	nodePurpose?: string;
}

export const CONTENT_ASSETS_INPUT_SCHEMA = {
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
} as const;

export async function executeContentAssets(
	ctx: PluginContext,
	localAssets: ContentLocalAssetService,
	sessionCwd: string,
	input: AssetsInput,
) {
	try {
		if (input.action === "list") {
			const candidates = await localAssets.list(input.paths, input.recursive);
			return { ok: true, status: "listed", count: candidates.length, candidates };
		}
		const imported = await localAssets.import({
			projectDir: resolveContentProjectCwd(input, sessionCwd),
			paths: input.paths,
			recursive: input.recursive,
			directoryMode: input.directoryMode,
			targetNodeId: input.assetNodeId,
			expectedRevision: input.expectedRevision,
			nodeName: input.nodeName,
			nodePurpose: input.nodePurpose,
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
}
