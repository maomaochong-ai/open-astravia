import { describe, expect, it } from "vitest";
import { createRemoteInviteMailbox, RemoteInviteMailboxError } from "./remote-invite-mailbox";

const boxUrl = "https://relay.test/v2/invite/PLACEHOLDER_BOX_ID_0123456789abcdefgh";
const token = "desktop_invite_token_0123456789abcdefghijklmnop";
const envelope = { v: 1 as const, nonce: "n".repeat(32), ciphertext: "c".repeat(32) };

interface Recorded {
	readonly method: string;
	readonly headers: Headers;
	readonly body: string | null;
}

function recordingFetch(status: number): { fetch: typeof fetch; calls: Recorded[] } {
	const calls: Recorded[] = [];
	const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({
			method: init?.method ?? "GET",
			headers: new Headers(init?.headers),
			body: (init?.body as string) ?? null,
		});
		return new Response(null, { status });
	}) as typeof fetch;
	return { fetch: fetchImpl, calls };
}

describe("invite mailbox", () => {
	it("carries the writer token the relay uses to tell the desktop from a stranger", async () => {
		const { fetch: fetchImpl, calls } = recordingFetch(204);
		const mailbox = createRemoteInviteMailbox(fetchImpl);

		await mailbox.publish(boxUrl, token, envelope, 60_000);

		expect(calls).toHaveLength(1);
		const [call] = calls;
		expect(call?.headers.get("X-Astravia-Invite-Token")).toBe(token);
		// 默认中继是上游实例，只认旧头名；两个头名缺一个都会让线上发布邀请码 401。
		expect(call?.headers.get("X-Vetta-Invite-Token")).toBe(token);
		expect(call?.method).toBe("PUT");
		expect(JSON.parse(call?.body ?? "{}")).toEqual({ envelope, ttlMs: 60_000 });
	});

	it("withdraws with the same writer token", async () => {
		const { fetch: fetchImpl, calls } = recordingFetch(204);
		const mailbox = createRemoteInviteMailbox(fetchImpl);

		await mailbox.withdraw(boxUrl, token);

		const [call] = calls;
		expect(call?.method).toBe("DELETE");
		expect(call?.headers.get("X-Astravia-Invite-Token")).toBe(token);
		expect(call?.headers.get("X-Vetta-Invite-Token")).toBe(token);
	});

	it("surfaces the relay status so a publish refusal is not read as an unreachable relay", async () => {
		const { fetch: fetchImpl } = recordingFetch(401);
		const mailbox = createRemoteInviteMailbox(fetchImpl);

		await expect(mailbox.publish(boxUrl, token, envelope, 60_000)).rejects.toBeInstanceOf(RemoteInviteMailboxError);
		await expect(mailbox.publish(boxUrl, token, envelope, 60_000)).rejects.toMatchObject({ status: 401 });
	});
});
