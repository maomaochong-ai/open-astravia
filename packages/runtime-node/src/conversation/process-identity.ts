import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { nodeErrorCode } from "./node-error-code.js";

export function currentProcessStartedAtMs(): number {
	return Math.floor(performance.timeOrigin);
}

export function isLocalProcessAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	if (process.platform === "win32") {
		const inspection = inspectWindowsProcess(pid);
		if (inspection.kind !== "unknown") return inspection.kind === "alive";
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return nodeErrorCode(error) === "EPERM";
	}
}

export function readLocalProcessStartedAtMs(pid: number): number | undefined {
	if (!Number.isInteger(pid) || pid <= 0) return undefined;
	if (pid === process.pid) return currentProcessStartedAtMs();
	try {
		if (process.platform === "linux") return readLinuxProcessStartedAtMs(pid);
		if (process.platform === "darwin") return readDarwinProcessStartedAtMs(pid);
		if (process.platform === "win32") {
			const result = inspectWindowsProcess(pid);
			return result.kind === "alive" ? result.startedAtMs : undefined;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function readLinuxProcessStartedAtMs(pid: number): number | undefined {
	const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
	const commandEnd = raw.lastIndexOf(")");
	if (commandEnd < 0) return undefined;
	const fields = raw.slice(commandEnd + 2).split(/\s+/);
	const startTicks = Number(fields[19]);
	const uptimeSeconds = Number(readFileSync("/proc/uptime", "utf8").split(/\s+/)[0]);
	if (!Number.isFinite(startTicks) || !Number.isFinite(uptimeSeconds)) return undefined;
	return Math.floor(Date.now() - uptimeSeconds * 1000 + (startTicks / 100) * 1000);
}

function readDarwinProcessStartedAtMs(pid: number): number | undefined {
	const elapsedSeconds = Number(
		execFileSync("ps", ["-p", String(pid), "-o", "etimes="], { encoding: "utf8", timeout: 2000 }).trim(),
	);
	return Number.isFinite(elapsedSeconds) && elapsedSeconds >= 0
		? Math.floor(Date.now() - elapsedSeconds * 1000)
		: undefined;
}

type WindowsProcessInspection =
	| { readonly kind: "alive"; readonly startedAtMs: number }
	| { readonly kind: "dead" | "unknown" };

function inspectWindowsProcess(pid: number): WindowsProcessInspection {
	try {
		const output = execFileSync(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				`$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($null -eq $p -or $null -eq $p.StartTime) { 'DEAD' } else { [int64]([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds() }`,
			],
			{ encoding: "utf8", timeout: 5000, windowsHide: true },
		).trim();
		if (!output || output === "DEAD") return { kind: "dead" };
		const startedAtMs = Number(output);
		return Number.isFinite(startedAtMs) && startedAtMs > 0
			? { kind: "alive", startedAtMs: Math.floor(startedAtMs) }
			: { kind: "unknown" };
	} catch {
		return { kind: "unknown" };
	}
}
