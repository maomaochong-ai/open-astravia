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
			`[文件规模警示] \`${filePath}\` 当前 ${lineCount} 行，已超过 ${WARNING_THRESHOLD} 行。`,
			"请对本次改动保持警惕，确认职责边界清晰，代码仍然易于维护、可扩展且易读。",
			"如果文件在本次任务前就已达到这一规模，且拆分或整理与当前任务无关，不要求中断当前任务处理；完成任务后可在你判断确有必要且符合项目规范时再处理。",
			"此提示不阻断当前工具调用。",
		].join(" ");
	}

	return [
		`[文件规模提示] \`${filePath}\` 当前 ${lineCount} 行，已超过 ${NOTICE_THRESHOLD} 行。`,
		"请确认本次改动没有继续加重职责混合，并保持代码易于维护、可扩展且易读。",
		"如果这一规模并非由本次改动造成、文件此前就已较长，可以忽略此提示；不要求为与当前任务无关的历史问题额外重构。",
		"此提示不阻断当前工具调用。",
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
