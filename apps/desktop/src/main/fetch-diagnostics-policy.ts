/** User-initiated cancellation is expected control flow, not a network failure. */
export function shouldLogFetchFailure(error: unknown, signal?: AbortSignal | null): boolean {
	const reason = signal?.aborted ? signal.reason : error;
	return !(
		reason !== null &&
		typeof reason === "object" &&
		"name" in reason &&
		reason.name === "McpSetupLoginCancelled"
	);
}
