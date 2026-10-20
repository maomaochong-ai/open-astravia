import { type FileExplorerEntryNameIssue, getFileExplorerEntryNameIssue } from "@/preload/file-explorer-entry-name";

export type RenameNameProblem =
	| { readonly kind: "invalid"; readonly issue: FileExplorerEntryNameIssue }
	| { readonly kind: "exists" };

export interface RenameNameInput {
	readonly newName: string;
	readonly oldPath: string;
	/** Siblings of the renamed entry; `undefined` when the directory has not been listed yet. */
	readonly siblings: readonly { readonly name: string; readonly path: string }[] | undefined;
	readonly windows: boolean;
	/** Windows and macOS keep names unique regardless of case; Linux does not. */
	readonly caseInsensitive: boolean;
}

/**
 * 重命名前的本地校验：名字规则与新建共用一份（主进程还会再校验一次），同名冲突在这里先拦下。
 * 等到 IPC 失败再报错，用户会以为重命名功能坏了。
 */
export function getRenameNameProblem(input: RenameNameInput): RenameNameProblem | null {
	const issue = getFileExplorerEntryNameIssue(input.newName, { windows: input.windows });
	if (issue) return { kind: "invalid", issue };
	if (!input.siblings) return null;
	const fold = (value: string): string => (input.caseInsensitive ? value.toLowerCase() : value);
	const comparable = fold(input.newName);
	const conflict = input.siblings.some((entry) => entry.path !== input.oldPath && fold(entry.name) === comparable);
	return conflict ? { kind: "exists" } : null;
}
