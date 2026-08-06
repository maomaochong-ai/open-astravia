export type FileExplorerEntryNameIssue =
	| "empty"
	| "dot-path"
	| "path-separator"
	| "invalid-character"
	| "reserved-name"
	| "trailing-character";

export const FILE_EXPLORER_ENTRY_EXISTS_ERROR = "FILE_EXPLORER_ENTRY_EXISTS";

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const WINDOWS_INVALID_CHARACTERS = /[\u0000-\u001f<>:"|?*]/;

export function getFileExplorerEntryNameIssue(
	name: string,
	options: { windows: boolean },
): FileExplorerEntryNameIssue | null {
	if (name.length === 0 || name.trim().length === 0) return "empty";
	if (name === "." || name === "..") return "dot-path";
	if (name.includes("/") || name.includes("\\") || name.includes("\0")) return "path-separator";
	if (!options.windows) return null;
	if (WINDOWS_INVALID_CHARACTERS.test(name)) return "invalid-character";
	if (WINDOWS_RESERVED_NAMES.test(name)) return "reserved-name";
	if (/[. ]$/.test(name)) return "trailing-character";
	return null;
}
