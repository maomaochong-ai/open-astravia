export interface ToolEventInputBase {
	description?: string;
}

export interface BashToolInput extends ToolEventInputBase {
	command: string;
	timeout?: number;
	run_in_background?: boolean;
}

export interface ReadToolInput extends ToolEventInputBase {
	path: string;
	offset?: number;
	limit?: number;
}

export interface AnchorEditInput {
	anchor: string;
	end_anchor?: string;
	new_text: string;
	insert_after?: boolean;
}

export interface EditToolInput extends ToolEventInputBase {
	path: string;
	oldText?: string;
	newText?: string;
	edits?: AnchorEditInput[];
}

export interface WriteToolInput extends ToolEventInputBase {
	path: string;
	content: string;
}

export interface GrepToolInput extends ToolEventInputBase {
	pattern: string;
	path?: string;
	glob?: string;
	ignoreCase?: boolean;
	literal?: boolean;
	context?: number;
	limit?: number;
}

export interface FindToolInput extends ToolEventInputBase {
	pattern: string;
	path?: string;
	limit?: number;
}

export interface GlobToolInput extends ToolEventInputBase {
	pattern: string;
	path?: string;
	limit?: number;
}

export interface LsToolInput extends ToolEventInputBase {
	path?: string;
	limit?: number;
}

export interface TreeToolInput extends ToolEventInputBase {
	path?: string;
	maxDepth?: number;
	limit?: number;
	includeFiles?: boolean;
	includeHidden?: boolean;
	ignore?: string[];
}

export interface ToolOutputTruncation {
	readonly content: string;
	readonly truncated: boolean;
	readonly truncatedBy: "lines" | "bytes" | null;
	readonly totalLines: number;
	readonly totalBytes: number;
	readonly outputLines: number;
	readonly outputBytes: number;
	readonly lastLinePartial: boolean;
	readonly firstLineExceedsLimit: boolean;
	readonly maxLines: number;
	readonly maxBytes: number;
}

export interface BashToolDetails {
	truncation?: ToolOutputTruncation;
	fullOutputPath?: string;
	pathCorrections?: Array<{ original: string; corrected: string }>;
	backgroundTaskId?: string;
	autoPromoted?: boolean;
}

export interface ReadToolDetails {
	readonly truncation?: ToolOutputTruncation;
	readonly image?: {
		readonly originalPath: string;
		readonly originalMimeType: string;
		readonly originalSizeBytes: number;
		readonly originalWidth: number;
		readonly originalHeight: number;
		readonly processedMimeType: string;
		readonly processedSizeBytes: number;
		readonly processedWidth: number;
		readonly processedHeight: number;
		readonly wasResized: boolean;
	};
}

export interface EditToolDetails {
	readonly diff: string;
	readonly firstChangedLine?: number;
	readonly appliedEdits?: number;
}

export interface GrepToolDetails {
	readonly truncation?: ToolOutputTruncation;
	readonly matchLimitReached?: number;
	readonly linesTruncated?: boolean;
}

export interface FindToolDetails {
	readonly truncation?: ToolOutputTruncation;
	readonly resultLimitReached?: number;
}

export interface GlobToolDetails {
	readonly durationMs: number;
	readonly numFiles: number;
	readonly truncation?: ToolOutputTruncation;
	readonly resultLimitReached?: number;
}

export interface LsToolDetails {
	readonly truncation?: ToolOutputTruncation;
	readonly entryLimitReached?: number;
}

export interface TreeToolDetails {
	readonly truncation?: ToolOutputTruncation;
	readonly nodeLimitReached?: number;
	readonly scanLimitReached?: number;
	readonly totalNodesDiscovered: number;
	readonly nodesRendered: number;
}
