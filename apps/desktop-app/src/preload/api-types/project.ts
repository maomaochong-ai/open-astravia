// ─── Project import / export ───
//
// Mirrors `src/main/ipc/project-export.ts`. Both directions can return either
// the success payload OR an `{ error: { code, message } }` envelope so the
// renderer can branch on the failure mode without try/catch.

export type ProjectExportErrorCode =
	| "unsupported-type"
	| "invalid-zip"
	| "unsupported-zip"
	| "incompatible-version"
	| "extract-failed"
	| "user-cancelled";

export interface ProjectExportError {
	error: { code: ProjectExportErrorCode; message: string };
}

export interface ProjectExportSuccess {
	saved: boolean;
	zipPath?: string;
}

export interface ProjectImportSuccess {
	path: string;
	name: string;
	type: "normal" | "batch";
	missingSources?: string[];
}

export interface DesktopProjectApi {
	/** Export a project to a zip via native save dialog. */
	export(projectDir: string): Promise<ProjectExportSuccess | ProjectExportError>;
	/** Import a project from a zip via native open dialog. `null` = user cancelled. */
	import(): Promise<ProjectImportSuccess | ProjectExportError | null>;
	/** Read a project's `.vetta/meta.json` (used to detect project type). `null` if absent. */
	readMeta(projectDir: string): Promise<Record<string, unknown> | null>;
}
