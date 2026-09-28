import { REMOTE_PROTOCOL_VERSION } from "@vetta/remote-control";

/**
 * What a relay address turned out to be: a relay this desktop can use, one too old for
 * connection codes (it still carries the phone's connection), one on another protocol,
 * or nothing that answered.
 */
export type RemoteRelayProbeResult = "ok" | "noInviteCodes" | "incompatible" | "unreachable";

const PROBE_TIMEOUT_MS = 8_000;
/** A well-formed mailbox name nobody uses: a relay with mailboxes refuses POST on it (405), an older one does not know the route. */
const PROBE_BOX_ID = "A".repeat(43);

export async function probeRemoteRelay(
	relayBaseUrl: string,
	fetchImpl: typeof fetch = fetch,
): Promise<RemoteRelayProbeResult> {
	const base = relayBaseUrl.replace(/^ws(s?):/, "http$1:");
	try {
		const health = await fetchImpl(`${base}/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
		if (!health.ok) return "unreachable";
		const body = (await health.json().catch(() => undefined)) as { protocolVersion?: unknown } | undefined;
		if (body?.protocolVersion !== REMOTE_PROTOCOL_VERSION) return "incompatible";
		const mailbox = await fetchImpl(`${base}/v2/invite/${PROBE_BOX_ID}`, {
			method: "POST",
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});
		return mailbox.status === 405 ? "ok" : "noInviteCodes";
	} catch {
		return "unreachable";
	}
}
