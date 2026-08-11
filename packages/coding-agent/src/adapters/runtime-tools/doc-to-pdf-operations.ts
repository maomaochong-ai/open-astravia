import { constants } from "node:fs";
import { access } from "node:fs/promises";
import nodePath from "node:path";
import type {
	CommandProcessPort,
	DesktopCommandResult,
	DocToPdfDetectedBackend,
	DocToPdfOperations,
} from "@vetta/runtime-tools/coding";
import { createCodingAgentCommandProcessHost } from "./command-process-host.js";

const PROCESS_TIMEOUT_MS = 60_000;
const PROCESS_MAX_BUFFER_BYTES = 1024 * 1024;

export interface CodingAgentDocToPdfOperationsOptions {
	readonly platform?: NodeJS.Platform;
	readonly commandProcess?: CommandProcessPort;
	readonly fileExists?: (filePath: string) => Promise<boolean>;
}

/** Microsoft Office/WPS 的本地宿主操作；Runtime Tool 只消费 DocToPdfOperations。 */
export function createCodingAgentDocToPdfOperations(
	options: CodingAgentDocToPdfOperationsOptions = {},
): DocToPdfOperations {
	const platform = options.platform ?? process.platform;
	const commandProcess = options.commandProcess ?? createCodingAgentCommandProcessHost();
	const exists = options.fileExists ?? defaultFileExists;
	return {
		detect: () => detectBackend(platform, commandProcess, exists),
		convert: (inputPath, outputPath, backend) =>
			convertDocument(platform, commandProcess, inputPath, outputPath, backend),
	};
}

async function detectBackend(
	platform: NodeJS.Platform,
	commandProcess: CommandProcessPort,
	fileExists: (filePath: string) => Promise<boolean>,
): Promise<DocToPdfDetectedBackend | null> {
	if (platform === "darwin") {
		if (await fileExists("/Applications/Microsoft Word.app")) {
			return { type: "msoffice", label: "Microsoft Office (macOS)" };
		}
		if (await fileExists("/Applications/wpsoffice.app")) {
			return { type: "wps", label: "WPS Office (macOS)" };
		}
		return null;
	}
	if (platform === "win32") {
		if (
			await commandSucceeds(commandProcess, "powershell", [
				"-Command",
				"Get-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\Office\\*\\Word -ErrorAction Stop",
			])
		) {
			return { type: "msoffice", label: "Microsoft Office (Windows)" };
		}
		if (await commandSucceeds(commandProcess, "which", ["winword"])) {
			return { type: "msoffice", label: "Microsoft Office (Windows)" };
		}
		if (
			await commandSucceeds(commandProcess, "powershell", [
				"-Command",
				"Get-ItemProperty HKLM:\\SOFTWARE\\Kingsoft\\Office -ErrorAction Stop",
			])
		) {
			return { type: "wps", label: "WPS Office (Windows)" };
		}
		if (await commandSucceeds(commandProcess, "which", ["wps"])) {
			return { type: "wps", label: "WPS Office (Windows)" };
		}
		return null;
	}
	if (platform === "linux" && (await commandSucceeds(commandProcess, "which", ["wps"]))) {
		return { type: "wps", label: "WPS Office (Linux)" };
	}
	return null;
}

async function convertDocument(
	platform: NodeJS.Platform,
	commandProcess: CommandProcessPort,
	inputPath: string,
	outputPath: string,
	backend: DocToPdfDetectedBackend,
): Promise<string> {
	if (backend.type === "msoffice" && platform === "darwin") {
		const script = `
tell application "Microsoft Word"
	set wasRunning to running
	open POSIX file "${escapeAppleScript(inputPath)}"
	set theDoc to active document
	save as theDoc file format format PDF file name POSIX file "${escapeAppleScript(outputPath)}"
	close theDoc saving no
	if not wasRunning then quit
end tell`;
		await runChecked(commandProcess, "osascript", ["-e", script]);
		return outputPath;
	}
	if (backend.type === "msoffice" && platform === "win32") {
		const script = `
$word = New-Object -ComObject Word.Application
$word.Visible = $false
try {
	$doc = $word.Documents.Open("${escapeWindowsPath(inputPath)}")
	$doc.SaveAs2("${escapeWindowsPath(outputPath)}", 17)
	$doc.Close()
} finally {
	$word.Quit()
	[System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null
}`;
		await runChecked(commandProcess, "powershell", ["-Command", script]);
		return outputPath;
	}
	if (backend.type === "wps" && platform === "darwin") {
		await runChecked(commandProcess, "/Applications/wpsoffice.app/Contents/MacOS/wps", [
			"--headless",
			"--convert-to",
			"pdf",
			"--outdir",
			nodePath.dirname(outputPath),
			inputPath,
		]);
		return outputPath;
	}
	if (backend.type === "wps" && platform === "win32") {
		const script = `
$wps = New-Object -ComObject WPS.Application
$wps.Visible = $false
try {
	$doc = $wps.Documents.Open("${escapeWindowsPath(inputPath)}")
	$doc.ExportAsFixedFormat("${escapeWindowsPath(outputPath)}", 0)
	$doc.Close()
} finally {
	$wps.Quit()
	[System.Runtime.Interopservices.Marshal]::ReleaseComObject($wps) | Out-Null
}`;
		await runChecked(commandProcess, "powershell", ["-Command", script]);
		return outputPath;
	}
	if (backend.type === "wps" && platform === "linux") {
		await runChecked(commandProcess, "wps", [
			"--headless",
			"--convert-to",
			"pdf",
			"--outdir",
			nodePath.dirname(outputPath),
			inputPath,
		]);
		return outputPath;
	}
	throw new Error(
		`${backend.type === "msoffice" ? "Microsoft Office" : "WPS Office"} conversion is not supported on ${platform}`,
	);
}

async function commandSucceeds(
	commandProcess: CommandProcessPort,
	executable: string,
	args: readonly string[],
): Promise<boolean> {
	try {
		return (await runProcess(commandProcess, executable, args)).code === 0;
	} catch {
		return false;
	}
}

async function runChecked(
	commandProcess: CommandProcessPort,
	executable: string,
	args: readonly string[],
): Promise<DesktopCommandResult> {
	const result = await runProcess(commandProcess, executable, args);
	if (result.code !== 0) {
		throw new Error(result.stderr.trim() || `${executable} exited with code ${result.code}`);
	}
	return result;
}

function runProcess(
	commandProcess: CommandProcessPort,
	executable: string,
	args: readonly string[],
): Promise<DesktopCommandResult> {
	return commandProcess.run(executable, args, {
		timeoutMs: PROCESS_TIMEOUT_MS,
		maxBufferBytes: PROCESS_MAX_BUFFER_BYTES,
	});
}

async function defaultFileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

function escapeAppleScript(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeWindowsPath(value: string): string {
	return value.replace(/\\/g, "\\\\");
}
