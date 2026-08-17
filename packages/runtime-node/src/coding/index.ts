export { NodeCodingToolResultArtifactStore } from "../host/result-artifact-storage.js";
export {
	CODING_TOOL_AVAILABILITY_ERROR_CODES,
	CodingToolAvailabilityError,
	type CodingToolAvailabilityErrorCode,
	guardCodingToolRegistration,
} from "./coding-tool-availability.js";
export {
	type CodingToolAvailabilityState,
	type CodingToolCatalog,
	type CodingToolCatalogEntry,
	type CodingToolCatalogSnapshot,
	type CodingToolCatalogSnapshotLease,
	type CodingToolRegistry,
	type CodingToolRevokeOptions,
	InMemoryCodingToolRegistry,
	type InMemoryCodingToolRegistryOptions,
} from "./coding-tool-catalog.js";
export {
	type CodingToolResultContext,
	type CodingToolResultPolicy,
	PRESERVE_CODING_TOOL_RESULT_POLICY,
} from "./coding-tool-result-policy.js";
export {
	CODING_TOOLS_FEATURE_ID,
	type CodingToolActivationResolver,
	type CodingToolCatalogRefresher,
	type CodingToolRegistrationFilter,
	type CodingToolsFeatureOptions,
	createCodingToolsFeature,
} from "./coding-tools-feature.js";
export * from "./host/index.js";
export {
	type CodingToolExecutable,
	type CodingToolExecutableResolver,
	createLocalCodingToolExecutableResolver,
	createNodeBackgroundCommandHost,
	createNodeForegroundCommandHost,
	killNodeProcessTree,
	type LocalCodingToolExecutableResolverOptions,
	type NodeBackgroundCommandHostOptions,
	type NodeForegroundCommandHostOptions,
	type NodeShellCommand,
} from "./host/index.js";
export {
	createNodeCodingToolEnvironment,
	createNodeCommandToolEnvironment,
	type NodeCodingToolEnvironment,
	type NodeCodingToolEnvironmentOptions,
	type NodeCommandToolEnvironment,
	type NodeCommandToolEnvironmentOptions,
	type NodeSpecializedToolRegistrationContext,
} from "./node-tool-environment.js";
export {
	type BackgroundCommandExecutorOptions,
	type BackgroundCommandToolDetails,
	createBackgroundCommandToolExecutor,
} from "./shared/background-command-executor.js";
export type {
	BackgroundCommandHost,
	BackgroundCommandOutput,
	BackgroundCommandOutputStore,
	BackgroundCommandProcess,
	BackgroundCommandProcessOperations,
	SpawnBackgroundCommandProcessOptions,
} from "./shared/background-command-host.js";
export { createBackgroundCommandService } from "./shared/background-command-lifecycle.js";
export type {
	BackgroundCommandEvent,
	BackgroundCommandService,
	BackgroundCommandSnapshot,
	BackgroundCommandStatus,
	BackgroundCommandStopReason,
	ReadBackgroundCommandOutputOptions,
	SpawnBackgroundCommandOptions,
} from "./shared/background-command-service.js";
export { buildBackgroundCommandNotification } from "./shared/background-command-service.js";
export {
	type CommandToolExecutor,
	type CommandToolExecutorRequest,
	type CommandToolInput,
	CommandToolInputSchema,
	type CommandToolName,
} from "./shared/command-tool.js";
export {
	type AsyncExecutionGate,
	type CommandProcessOptions,
	type CommandProcessPort,
	DesktopCommandAbortedError,
	type DesktopCommandLocation,
	type DesktopCommandPort,
	type DesktopCommandResult,
} from "./shared/desktop-command.js";
export {
	type CommandSpawnContext,
	type CommandSpawnHook,
	createForegroundCommandToolExecutor,
	DEFAULT_COMMAND_BLOCK_UNTIL_SEC,
	type ForegroundCommandExecutorOptions,
	type ForegroundCommandOperations,
	type ForegroundCommandToolDetails,
} from "./shared/foreground-command-executor.js";
export { resolveExistingPath } from "./shared/path-resolution.js";
export { decodeTextBuffer, sanitizeBinaryOutput } from "./shared/text-decoding.js";
export {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	GREP_MAX_LINE_LENGTH,
	type TruncationOptions,
	type TruncationResult,
	truncateHead,
	truncateLine,
	truncateTail,
} from "./shared/truncation.js";
export {
	CODING_TOOL_SCOPES,
	type CodingToolActivation,
	type CodingToolCategory,
	type CodingToolRegistration,
	type CodingToolScope,
	type CodingToolSideEffect,
	DEFAULT_CODING_TOOL_SCOPE,
	selectCodingToolRegistrations,
	selectCodingTools,
	selectCodingToolsForScope,
} from "./tool-registration.js";
export {
	BASH_TOOL_CATEGORY,
	BASH_TOOL_DESCRIPTION,
	type BashToolInput,
	BashToolInputSchema,
	type BashToolOptions,
	type BashToolRegistrationOptions,
	createBashTool,
	createBashToolRegistration,
	getBashToolScopes,
} from "./tools/bash/index.js";
export {
	createDocToPdfTool,
	createDocToPdfToolRegistration,
	DOC_TO_PDF_TOOL_CATEGORY,
	DOC_TO_PDF_TOOL_DESCRIPTION,
	DOC_TO_PDF_TOOL_SCOPES,
	type DocToPdfDetectedBackend,
	type DocToPdfOfficeBackend,
	type DocToPdfOperations,
	type DocToPdfToolInput,
	DocToPdfToolInputSchema,
	type DocToPdfToolOptions,
} from "./tools/doc-to-pdf/index.js";
export {
	type AnchorEditInput,
	AnchorEditInputSchema,
	createEditTool,
	createEditToolRegistration,
	EDIT_TOOL_CATEGORY,
	EDIT_TOOL_DESCRIPTION,
	EDIT_TOOL_SCOPES,
	type EditOperations,
	type EditPathPolicy,
	type EditToolDetails,
	type EditToolInput,
	EditToolInputSchema,
	type EditToolOptions,
} from "./tools/edit/index.js";
export {
	createExtractTextFromImageTool,
	createExtractTextFromImageToolRegistration,
	EXTRACT_TEXT_FROM_IMAGE_TOOL_CATEGORY,
	EXTRACT_TEXT_FROM_IMAGE_TOOL_DESCRIPTION,
	EXTRACT_TEXT_FROM_IMAGE_TOOL_SCOPES,
	type ExtractTextFromImageToolInput,
	ExtractTextFromImageToolInputSchema,
	type ExtractTextFromImageToolOptions,
} from "./tools/extract-text-from-image/index.js";
export {
	createExtractTextFromPdfTool,
	createExtractTextFromPdfToolRegistration,
	EXTRACT_TEXT_FROM_PDF_TOOL_CATEGORY,
	EXTRACT_TEXT_FROM_PDF_TOOL_DESCRIPTION,
	EXTRACT_TEXT_FROM_PDF_TOOL_SCOPES,
	type ExtractTextFromPdfToolInput,
	ExtractTextFromPdfToolInputSchema,
	type ExtractTextFromPdfToolOptions,
} from "./tools/extract-text-from-pdf/index.js";
export {
	createFindTool,
	createFindToolRegistration,
	FIND_TOOL_CATEGORY,
	FIND_TOOL_DESCRIPTION,
	FIND_TOOL_SCOPES,
	type FindOperations,
	type FindToolDetails,
	type FindToolInput,
	FindToolInputSchema,
	type FindToolOptions,
} from "./tools/find/index.js";
export {
	createGlobTool,
	createGlobToolRegistration,
	GLOB_TOOL_CATEGORY,
	GLOB_TOOL_DESCRIPTION,
	GLOB_TOOL_SCOPES,
	type GlobOperations,
	type GlobToolDetails,
	type GlobToolInput,
	GlobToolInputSchema,
	type GlobToolOptions,
} from "./tools/glob/index.js";
export {
	createGrepTool,
	createGrepToolRegistration,
	GREP_TOOL_CATEGORY,
	GREP_TOOL_DESCRIPTION,
	GREP_TOOL_SCOPES,
	type GrepOperations,
	type GrepToolDetails,
	type GrepToolInput,
	GrepToolInputSchema,
	type GrepToolOptions,
} from "./tools/grep/index.js";
export {
	createHtmlToPdfTool,
	createHtmlToPdfToolRegistration,
	HTML_TO_PDF_TOOL_CATEGORY,
	HTML_TO_PDF_TOOL_DESCRIPTION,
	HTML_TO_PDF_TOOL_SCOPES,
	type HtmlToPdfToolInput,
	HtmlToPdfToolInputSchema,
	type HtmlToPdfToolOptions,
} from "./tools/html-to-pdf/index.js";
export {
	createLsTool,
	createLsToolRegistration,
	LS_TOOL_CATEGORY,
	LS_TOOL_DESCRIPTION,
	LS_TOOL_SCOPES,
	type LsOperations,
	type LsStat,
	type LsToolDetails,
	type LsToolInput,
	LsToolInputSchema,
	type LsToolOptions,
} from "./tools/ls/index.js";
export {
	createReadTool,
	createReadToolRegistration,
	formatDimensionNote,
	formatImageResizeFailureNote,
	type ImageResizeFailure,
	type ImageResizeOptions,
	type ImageResizeResult,
	isImageResizeFailure,
	READ_TOOL_CATEGORY,
	READ_TOOL_DESCRIPTION,
	READ_TOOL_SCOPES,
	type ReadImageProcessor,
	type ReadOperations,
	type ReadToolDetails,
	type ReadToolInput,
	ReadToolInputSchema,
	type ReadToolOptions,
	type ResizedImage,
	resizeImageBuffer,
} from "./tools/read/index.js";
export {
	createRenderPdfPageTool,
	createRenderPdfPageToolRegistration,
	RENDER_PDF_PAGE_TOOL_CATEGORY,
	RENDER_PDF_PAGE_TOOL_DESCRIPTION,
	RENDER_PDF_PAGE_TOOL_SCOPES,
	RenderPdfPageProcessAbortedError,
	type RenderPdfPageProcessPort,
	type RenderPdfPageProcessResult,
	type RenderPdfPageToolInput,
	RenderPdfPageToolInputSchema,
	type RenderPdfPageToolOptions,
} from "./tools/render-pdf-page/index.js";
export {
	createShellTool,
	createShellToolRegistration,
	getShellToolScopes,
	SHELL_TOOL_CATEGORY,
	SHELL_TOOL_DESCRIPTION,
	type ShellToolInput,
	ShellToolInputSchema,
	type ShellToolOptions,
	type ShellToolRegistrationOptions,
} from "./tools/shell/index.js";
export {
	createTreeTool,
	createTreeToolRegistration,
	TREE_TOOL_CATEGORY,
	TREE_TOOL_DESCRIPTION,
	TREE_TOOL_SCOPES,
	type TreeOperations,
	type TreeToolDetails,
	type TreeToolInput,
	TreeToolInputSchema,
	type TreeToolOptions,
} from "./tools/tree/index.js";
export {
	createWriteTool,
	createWriteToolRegistration,
	WRITE_TOOL_CATEGORY,
	WRITE_TOOL_DESCRIPTION,
	WRITE_TOOL_SCOPES,
	type WriteOperations,
	type WritePathPolicy,
	type WriteToolInput,
	WriteToolInputSchema,
	type WriteToolOptions,
} from "./tools/write/index.js";
