import { DurableObject } from "cloudflare:workers";
import { readInviteEnvelope } from "@vetta/remote-control";
import { relayInfo, relayWarn } from "./relay-log.js";

interface Env {
	readonly REMOTE_INVITE_BOX: DurableObjectNamespace<RemoteInviteBox>;
}

interface StoredInvite {
	readonly envelope: string;
	readonly writerHash: string;
	readonly expiresAt: number;
	readonly reads: number;
}

const INVITE_KEY = "invite";
/** No invite outlives the desktop's own ten minutes. */
export const MAX_INVITE_TTL_MS = 10 * 60 * 1_000;
/** Enough for a few typos of the password; each read hands out the ciphertext again. */
export const MAX_INVITE_READS = 10;

/**
 * One sealed pairing invite, named by a hash of its connection code (ADR-0136). The
 * desktop that wrote it may replace or withdraw it; anyone who knows the code may read
 * it a few times until it expires. The relay cannot open it.
 */
export class RemoteInviteBox extends DurableObject<Env> {
	async fetch(request: Request): Promise<Response> {
		const boxTag = request.headers.get("X-Vetta-Box-Tag") ?? "";
		const writerHash = request.headers.get("X-Vetta-Writer-Hash");
		const stored = await this.current();
		switch (request.method) {
			case "PUT": {
				if (!writerHash) return status(401);
				if (stored && stored.writerHash !== writerHash) {
					relayWarn("invite_write_rejected", { boxTag, reason: "taken" });
					return status(409);
				}
				const body = (await request.json().catch(() => undefined)) as Record<string, unknown> | undefined;
				const envelope = readInviteEnvelope(body?.envelope);
				if (!envelope) return status(400);
				const ttlMs =
					typeof body?.ttlMs === "number" && body.ttlMs > 0
						? Math.min(body.ttlMs, MAX_INVITE_TTL_MS)
						: MAX_INVITE_TTL_MS;
				const expiresAt = Date.now() + ttlMs;
				await this.ctx.storage.put(INVITE_KEY, {
					envelope: JSON.stringify(envelope),
					writerHash,
					expiresAt,
					reads: 0,
				} satisfies StoredInvite);
				await this.ctx.storage.setAlarm(expiresAt);
				relayInfo("invite_stored", { boxTag });
				return status(204);
			}
			case "GET": {
				if (!stored) return status(404);
				const reads = stored.reads + 1;
				if (reads >= MAX_INVITE_READS) await this.clear();
				else await this.ctx.storage.put(INVITE_KEY, { ...stored, reads } satisfies StoredInvite);
				relayInfo("invite_read", { boxTag, reads });
				return new Response(`{"envelope":${stored.envelope}}`, {
					headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
				});
			}
			case "DELETE": {
				if (!stored) return status(204);
				if (!writerHash || stored.writerHash !== writerHash) return status(401);
				await this.clear();
				relayInfo("invite_withdrawn", { boxTag });
				return status(204);
			}
			default:
				return status(405);
		}
	}

	async alarm(): Promise<void> {
		await this.clear();
	}

	/** The stored invite, unless it has expired (the alarm may not have run yet). */
	private async current(): Promise<StoredInvite | undefined> {
		const stored = await this.ctx.storage.get<StoredInvite>(INVITE_KEY);
		if (stored && stored.expiresAt <= Date.now()) {
			await this.clear();
			return undefined;
		}
		return stored;
	}

	private async clear(): Promise<void> {
		await this.ctx.storage.deleteAll();
		await this.ctx.storage.deleteAlarm();
	}
}

function status(code: number): Response {
	return new Response(null, { status: code, headers: { "Cache-Control": "no-store" } });
}
