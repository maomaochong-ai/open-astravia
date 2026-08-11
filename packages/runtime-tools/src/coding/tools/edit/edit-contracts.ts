export interface EditToolDetails {
	readonly diff: string;
	readonly firstChangedLine?: number;
	readonly appliedEdits?: number;
}

export interface EditOperations {
	readonly readFile: (absolutePath: string) => Promise<Buffer>;
	readonly writeFile: (absolutePath: string, content: string) => Promise<void>;
	readonly access: (absolutePath: string) => Promise<void>;
}

export interface EditPathPolicy {
	readonly getRejectionReason: (absolutePath: string) => string | undefined;
}

export interface EditToolOptions {
	readonly operations?: EditOperations;
	readonly pathPolicy: EditPathPolicy;
}
