/** Stable Coding Agent context helpers; host-specific file access is injected by callers. */

export type {
	ModelInputImage,
	ModelInputImageFailure,
	ModelInputImageProcessor,
	ModelInputImageResult,
} from "../model-context/image-normalization.js";
export {
	detectWorkspaceFacts,
	probeWorkspaceSignals,
	renderWorkspaceFacts,
	type WorkspaceFactsFileSource,
	type WorkspaceSignals,
} from "../model-context/workspace-facts.js";
