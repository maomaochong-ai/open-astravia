import { i18n } from "@shared/i18n";
import type { ToolPhaseInfo } from "@shared/store/atoms";

export function shortenPath(path: string): string {
	const parts = path.replace(/\\/g, "/").split("/");
	return parts.length > 3 ? `.../${parts.slice(-3).join("/")}` : path;
}

export function formatBytes(bytes: number | undefined): string {
	if (bytes === undefined) return i18n.t("chat:toolFormat.unknown");
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB"];
	let value = bytes / 1024;
	let unit = units[0];
	for (let i = 1; i < units.length && value >= 1024; i++) {
		value /= 1024;
		unit = units[i];
	}
	return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
}

export function formatDimensions(width: number | undefined, height: number | undefined): string {
	if (width === undefined || height === undefined || width <= 0 || height <= 0)
		return i18n.t("chat:toolFormat.unknown");
	return `${width} x ${height}`;
}

export function formatSignedCount(value: number): string {
	if (value > 0) return `+${value}`;
	return String(value);
}

export function lineCount(text: string): number {
	if (text.length === 0) return 0;
	return text.split("\n").length;
}

/** Compact "1.2s" / "12.3s" / "2m04s" — for header badges. */
export function formatDurationCompact(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.floor((ms % 60_000) / 1000);
	return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
}

/** Precise "12.345s" / "1m02.345s" — for the meta panel. */
export function formatDurationPrecise(ms: number): string {
	if (ms < 60_000) return `${(ms / 1000).toFixed(3)}s`;
	const minutes = Math.floor(ms / 60_000);
	const seconds = (ms % 60_000) / 1000;
	return `${minutes}m${seconds.toFixed(3).padStart(6, "0")}s`;
}

export function formatStartedAt(ms: number): string {
	const d = new Date(ms);
	return `${d.getHours().toString().padStart(2, "0")}:${d
		.getMinutes()
		.toString()
		.padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

/**
 * Render phases as a centred-dot string: "download 2.1s · ocr 12.3s · write 0.8s".
 * Each phase's duration = next phase's atMs minus its own (last uses totalMs).
 */
export function formatPhases(phases: ToolPhaseInfo[], totalMs: number): string {
	return phases
		.map((p, i) => {
			const end = i + 1 < phases.length ? phases[i + 1].atMs : totalMs;
			const dur = Math.max(0, end - p.atMs);
			return `${p.label} ${formatDurationCompact(dur)}`;
		})
		.join(" · ");
}
