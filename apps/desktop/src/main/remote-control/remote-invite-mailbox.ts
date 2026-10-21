import type { RemoteInviteEnvelope } from "@astravia/remote-control";

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

/** The relay answered and refused the invite; `status` is its HTTP status. Kept typed so callers
 *  can tell "no such route" (the relay predates codes) from "this invite was refused". */
export class RemoteInviteMailboxError extends Error {
	readonly status: number;

	constructor(status: number) {
		super(`invite mailbox refused the invite (${status})`);
		this.name = "RemoteInviteMailboxError";
		this.status = status;
	}
}

export function createRemoteInviteMailbox(fetchImpl: typeof fetch = fetch): RemoteInviteMailbox {
	return {
		async publish(boxUrl, token, envelope, ttlMs) {
			const response = await fetchImpl(boxUrl, {
				method: "PUT",
				headers: { "Content-Type": "application/json", "X-Astravia-Invite-Token": token },
				body: JSON.stringify({ envelope, ttlMs }),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			if (!response.ok) throw new RemoteInviteMailboxError(response.status);
		},
		async withdraw(boxUrl, token) {
			await fetchImpl(boxUrl, {
				method: "DELETE",
				headers: { "X-Astravia-Invite-Token": token },
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		},
	};
}
