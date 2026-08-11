import type { PluginContext, PluginPermission } from "@vetta-org/plugin-sdk";

/** Probe outcome semantics for the security audit UI. */
export type ProbeStatus =
	/** Control worked as designed (gate held or intended access succeeded). */
	| "pass"
	/** Host correctly blocked the attempt. */
	| "blocked"
	/** Security-relevant exposure / weaker isolation than a hard sandbox. */
	| "finding"
	/** Probe could not complete (missing grant, no cwd, unexpected throw shape). */
	| "skip"
	/** Probe infrastructure error. */
	| "error";

export type ProbeSeverity = "info" | "low" | "medium" | "high" | "critical";

export interface ProbeResult {
	id: string;
	category: string;
	title: string;
	status: ProbeStatus;
	severity: ProbeSeverity;
	summary: string;
	detail?: string;
	durationMs: number;
}

export interface ProbeContext {
	ctx: PluginContext;
	/** Absolute path inside the active conversation project when available. */
	projectRoot: string | null;
	/** Marker written under plugin storage for isolation checks. */
	probeToken: string;
}

export type ProbeFn = (probe: ProbeContext) => Promise<ProbeResult> | ProbeResult;

export interface ProbeDefinition {
	id: string;
	category: string;
	title: string;
	/** Default severity when the probe marks a finding. */
	findingSeverity: ProbeSeverity;
	run: ProbeFn;
}

export function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export function isPermissionDenied(error: unknown): boolean {
	const message = errorMessage(error).toLowerCase();
	return message.includes("permission denied") || message.includes("plugin permission denied");
}

export function isOutsideProject(error: unknown): boolean {
	const message = errorMessage(error).toLowerCase();
	return (
		message.includes("outside any known project") ||
		message.includes("outside any previewable") ||
		message.includes("path is outside")
	);
}

export function isStorageEscape(error: unknown): boolean {
	const message = errorMessage(error).toLowerCase();
	return (
		message.includes("escapes its namespace") ||
		message.includes("invalid plugin storage path") ||
		message.includes("invalid plugin id")
	);
}

export async function timedResult(
	definition: Pick<ProbeDefinition, "id" | "category" | "title">,
	run: () => Promise<Omit<ProbeResult, "id" | "category" | "title" | "durationMs">>,
): Promise<ProbeResult> {
	const started = performance.now();
	try {
		const body = await run();
		return {
			id: definition.id,
			category: definition.category,
			title: definition.title,
			durationMs: Math.round(performance.now() - started),
			...body,
		};
	} catch (error) {
		return {
			id: definition.id,
			category: definition.category,
			title: definition.title,
			status: "error",
			severity: "medium",
			summary: "Probe threw unexpectedly",
			detail: errorMessage(error),
			durationMs: Math.round(performance.now() - started),
		};
	}
}

export function permissionMatrix(ctx: PluginContext, permissions: readonly PluginPermission[]) {
	return permissions.map((permission) => ({
		permission,
		granted: ctx.permissions.has(permission),
	}));
}
