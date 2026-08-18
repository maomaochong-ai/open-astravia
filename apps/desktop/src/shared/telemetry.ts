export const TELEMETRY_CONTEXT_CHANNEL = "vetta:telemetry:set-context";

export interface TelemetryContext {
	appSessionId: string;
	distinctId: string;
	posthogSessionId?: string;
	userId?: string;
}

export function parseTelemetryContext(value: unknown): TelemetryContext | null {
	if (!isRecord(value)) return null;
	const appSessionId = parseIdentifier(value.appSessionId);
	const distinctId = parseIdentifier(value.distinctId);
	const posthogSessionId = parseOptionalIdentifier(value.posthogSessionId);
	const userId = parseOptionalIdentifier(value.userId);
	if (!appSessionId || !distinctId) return null;
	return {
		appSessionId,
		distinctId,
		...(posthogSessionId ? { posthogSessionId } : {}),
		...(userId ? { userId } : {}),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseIdentifier(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed === "" || trimmed.length > 128) return null;
	return trimmed;
}

function parseOptionalIdentifier(value: unknown): string | undefined {
	return value === undefined ? undefined : (parseIdentifier(value) ?? undefined);
}
