import type { SessionExecutionMode } from "@astravia/runtime-core";

export type ExecutionModeOverride = "inherit" | SessionExecutionMode;

export function normalizeExecutionModeOverride(
	value: unknown,
	fallback: ExecutionModeOverride = "inherit",
): ExecutionModeOverride {
	if (value === "sandbox" || value === "full-access") return value;
	return fallback;
}

export function resolveExecutionMode(
	override: ExecutionModeOverride | undefined,
	defaultMode: SessionExecutionMode,
): SessionExecutionMode {
	return override === "sandbox" || override === "full-access" ? override : defaultMode;
}
