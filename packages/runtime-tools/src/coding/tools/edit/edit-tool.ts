import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { resolveExistingPath } from "../../shared/path-resolution.js";
import { prepareAnchorEdits } from "./anchor-edit.js";
import { EDIT_TOOL_DESCRIPTION } from "./description.js";
import type { EditOperations, EditToolDetails, EditToolOptions } from "./edit-contracts.js";
import { generateDiffString, prepareExactTextEdit } from "./edit-text.js";
import { type EditToolInput, EditToolInputSchema } from "./schema.js";

const defaultEditOperations: EditOperations = {
	readFile: (path) => readFile(path),
	writeFile: (path, content) => writeFile(path, content, "utf-8"),
	access: (path) => access(path, constants.R_OK | constants.W_OK),
};

interface EditToolResult {
	readonly content: readonly [{ readonly type: "text"; readonly text: string }];
	readonly details: EditToolDetails;
}

async function executeAnchorMode(
	operations: EditOperations,
	absolutePath: string,
	displayPath: string,
	edits: NonNullable<EditToolInput["edits"]>,
	signal: AbortSignal,
): Promise<EditToolResult> {
	if (edits.length === 0) throw new Error("edits array is empty — provide at least one anchor edit.");
	try {
		await operations.access(absolutePath);
	} catch {
		throw new Error(`File not found: ${displayPath}`);
	}
	const rawContent = (await operations.readFile(absolutePath)).toString("utf-8");
	if (signal.aborted) throw new Error("Operation aborted");
	const edit = prepareAnchorEdits(rawContent, displayPath, edits);
	if (signal.aborted) throw new Error("Operation aborted");
	await operations.writeFile(absolutePath, edit.content);
	return {
		content: [{ type: "text", text: edit.receipt }],
		details: edit.details,
	};
}

function executeExactTextMode(
	operations: EditOperations,
	absolutePath: string,
	displayPath: string,
	oldText: string,
	newText: string,
	signal: AbortSignal,
): Promise<EditToolResult> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(new Error("Operation aborted"));
			return;
		}

		let aborted = false;
		const onAbort = (): void => {
			aborted = true;
			reject(new Error("Operation aborted"));
		};
		signal.addEventListener("abort", onAbort, { once: true });

		void (async () => {
			try {
				try {
					await operations.access(absolutePath);
				} catch {
					signal.removeEventListener("abort", onAbort);
					reject(new Error(`File not found: ${displayPath}`));
					return;
				}
				if (aborted) return;
				const rawContent = (await operations.readFile(absolutePath)).toString("utf-8");
				if (aborted) return;
				const edit = prepareExactTextEdit(rawContent, oldText, newText, displayPath);
				if (aborted) return;
				await operations.writeFile(absolutePath, edit.content);
				if (aborted) return;
				signal.removeEventListener("abort", onAbort);
				const diff = generateDiffString(edit.baseContent, edit.newContent);
				resolve({
					content: [{ type: "text", text: `Successfully replaced text in ${displayPath}.` }],
					details: { diff: diff.diff, firstChangedLine: diff.firstChangedLine },
				});
			} catch (error: unknown) {
				signal.removeEventListener("abort", onAbort);
				if (!aborted) reject(error);
			}
		})();
	});
}

export function createEditTool(cwd: string, options: EditToolOptions): RuntimeToolDefinition<EditToolInput> {
	const operations = options.operations ?? defaultEditOperations;
	const pathPolicy = options.pathPolicy;
	return {
		name: "edit",
		label: "edit",
		description: EDIT_TOOL_DESCRIPTION,
		inputSchema: EditToolInputSchema,
		async execute(request) {
			const { path, oldText, newText, edits } = request.input;
			const absolutePath = resolveExistingPath(path, cwd);
			const rejectionReason = pathPolicy.getRejectionReason(absolutePath);
			if (rejectionReason !== undefined) throw new Error(rejectionReason);
			if (edits !== undefined && (oldText !== undefined || newText !== undefined)) {
				throw new Error("Use either `edits` (anchor mode) or `oldText`/`newText` (exact-text mode), not both.");
			}
			if (edits !== undefined) {
				return executeAnchorMode(operations, absolutePath, path, edits, request.signal);
			}
			if (oldText === undefined || newText === undefined) {
				throw new Error(
					"Missing edit payload: provide `edits` (anchor mode, preferred) or both `oldText` and `newText`.",
				);
			}
			return executeExactTextMode(operations, absolutePath, path, oldText, newText, request.signal);
		},
	};
}
