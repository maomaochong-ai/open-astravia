import { createReadStream } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const NOTICE_THRESHOLD = 800;
const WARNING_THRESHOLD = 1200;

export async function countFileLines(filePath) {
	let lineFeeds = 0;
	let lastByte;

	for await (const chunk of createReadStream(filePath)) {
		for (const byte of chunk) {
			if (byte === 0x0a) lineFeeds += 1;
		}
		if (chunk.length > 0) lastByte = chunk.at(-1);
	}

	if (lastByte === undefined) return 0;
	return lineFeeds + (lastByte === 0x0a ? 0 : 1);
}

export function buildReminder(filePath, lineCount) {
	if (lineCount <= NOTICE_THRESHOLD) return undefined;

	if (lineCount > WARNING_THRESHOLD) {
		return [
			`[File size warning] \`${filePath}\` now has ${lineCount} lines, exceeding the ${WARNING_THRESHOLD}-line threshold.`,
			"Treat changes to this file with extra caution. Confirm that responsibilities and module boundaries remain clear and that the code remains maintainable, extensible, and readable.",
			"If the file was already this large before the current task and the size was not caused by your changes, you do not need to interrupt the current task for an unrelated refactor. After completing the task, you may address it if you consider that necessary and can do so in accordance with the project standards; no cleanup is mandatory.",
			"This warning is advisory and does not block the tool call.",
		].join(" ");
	}

	return [
		`[File size notice] \`${filePath}\` now has ${lineCount} lines, exceeding the ${NOTICE_THRESHOLD}-line threshold.`,
		"Check that this change does not further mix responsibilities and that the code remains maintainable, extensible, and readable.",
		"If the file was already this large before the current task and the size was not caused by your changes, you may ignore this notice; no unrelated historical refactor is required.",
		"This notice is advisory and does not block the tool call.",
	].join(" ");
}

export async function evaluateHookInput(input, lineCounter = countFileLines) {
	if (!isRecord(input) || input.hook_event_name !== "PostToolUse") return undefined;
	if (input.tool_name !== "Write" && input.tool_name !== "Edit") return undefined;
	if (!isRecord(input.tool_input) || typeof input.tool_input.file_path !== "string") return undefined;

	const cwd = typeof input.cwd === "string" && input.cwd.length > 0 ? input.cwd : process.cwd();
	const filePath = isAbsolute(input.tool_input.file_path)
		? input.tool_input.file_path
		: resolve(cwd, input.tool_input.file_path);
	const lineCount = await lineCounter(filePath);
	return buildReminder(displayPath(filePath, cwd), lineCount);
}

export function formatHookOutput(reminder) {
	if (reminder === undefined) return undefined;
	return JSON.stringify({
		hookSpecificOutput: {
			hookEventName: "PostToolUse",
			additionalContext: reminder,
		},
	});
}

async function main() {
	try {
		const rawInput = await readStdin();
		const reminder = await evaluateHookInput(JSON.parse(rawInput));
		const output = formatHookOutput(reminder);
		if (output !== undefined) process.stdout.write(`${output}\n`);
	} catch {
		// The hook is advisory: malformed input and file-system failures must never fail the tool call.
	}
}

function displayPath(filePath, cwd) {
	const relativePath = relative(cwd, filePath);
	if (relativePath.length === 0) return filePath;
	if (relativePath === ".." || relativePath.startsWith(`..\\`) || relativePath.startsWith("../")) return filePath;
	return relativePath.replaceAll("\\", "/");
}

function isRecord(value) {
	return typeof value === "object" && value !== null;
}

async function readStdin() {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(chunk);
	return Buffer.concat(chunks).toString("utf8");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	await main();
}
