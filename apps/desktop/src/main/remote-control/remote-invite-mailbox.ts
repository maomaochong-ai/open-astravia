import type { RemoteInviteEnvelope } from "@vetta/remote-control";

/**
 * The relay's invite mailbox (ADR-0136) as the desktop uses it: put a sealed invite
 * where a phone that knows the connection code can fetch it, and take it back once
 * the invite is used or gone.
 */
export interface RemoteInviteMailbox {
	publish(boxUrl: string, token: string, envelope: RemoteInviteEnvelope, ttlMs: number): Promise<void>;
	withdraw(boxUrl: string, token: string): Promise<void>;
}

const REQUEST_TIMEOUT_MS = 10_000;

export function createRemoteInviteMailbox(fetchImpl: typeof fetch = fetch): RemoteInviteMailbox {
	return {
		async publish(boxUrl, token, envelope, ttlMs) {
			const response = await fetchImpl(boxUrl, {
				method: "PUT",
				headers: { "Content-Type": "application/json", "X-Vetta-Invite-Token": token },
				body: JSON.stringify({ envelope, ttlMs }),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			if (!response.ok) throw new Error(`invite mailbox refused the invite (${response.status})`);
		},
		async withdraw(boxUrl, token) {
			await fetchImpl(boxUrl, {
				method: "DELETE",
				headers: { "X-Vetta-Invite-Token": token },
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		},
	};
}
