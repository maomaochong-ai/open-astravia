export interface SessionTraceContext {
	readonly interactionId: string;
}

/** Validate the privacy-safe correlation envelope at the first trusted boundary. */
export function parseSessionTraceContext(value: unknown): SessionTraceContext | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "object" || value === null) throw new Error("Invalid session trace context");
	const interactionId = (value as Record<string, unknown>).interactionId;
	if (
		typeof interactionId !== "string" ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(interactionId)
	) {
		throw new Error("Invalid interactionId");
	}
	return { interactionId };
}
