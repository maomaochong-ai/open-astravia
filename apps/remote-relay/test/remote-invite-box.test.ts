import { SELF } from "cloudflare:test";
import { inviteBoxId, openInvite, sealInvite } from "@vetta/remote-control";
import { describe, expect, it } from "vitest";

const token = "desktop_invite_token_0123456789abcdefghijklmnop";
const otherToken = "someone_else_token_0123456789abcdefghijklmnopq";

function put(boxId: string, body: unknown, writer: string | null = token): Promise<Response> {
	return SELF.fetch(`https://relay.test/v2/invite/${boxId}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json", ...(writer ? { "X-Vetta-Invite-Token": writer } : {}) },
		body: JSON.stringify(body),
	});
}

describe("invite mailbox (ADR-0136)", () => {
	it("hands the sealed invite to whoever knows the code, and the relay cannot open it", async () => {
		const code = "K7Q29MXD";
		const boxId = inviteBoxId(code);
		const envelope = await sealInvite("vetta://pair?v=2&p=room", code, "482913");
		expect((await put(boxId, { envelope, ttlMs: 60_000 })).status).toBe(204);

		const response = await SELF.fetch(`https://relay.test/v2/invite/${boxId}`);
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		const fetched = (await response.json()) as { envelope: typeof envelope };
		expect(fetched.envelope).toEqual(envelope);
		await expect(openInvite(fetched.envelope, code, "482913")).resolves.toBe("vetta://pair?v=2&p=room");
	});

	it("lets only the desktop that wrote an invite replace or withdraw it", async () => {
		const boxId = inviteBoxId("ABCD2345");
		const envelope = await sealInvite("vetta://pair?v=2", "ABCD2345", "000111");
		expect((await put(boxId, { envelope }, null)).status).toBe(401);
		expect((await put(boxId, { envelope })).status).toBe(204);
		expect((await put(boxId, { envelope }, otherToken)).status).toBe(409);

		const stranger = await SELF.fetch(`https://relay.test/v2/invite/${boxId}`, {
			method: "DELETE",
			headers: { "X-Vetta-Invite-Token": otherToken },
		});
		expect(stranger.status).toBe(401);
		const withdrawn = await SELF.fetch(`https://relay.test/v2/invite/${boxId}`, {
			method: "DELETE",
			headers: { "X-Vetta-Invite-Token": token },
		});
		expect(withdrawn.status).toBe(204);
		expect((await SELF.fetch(`https://relay.test/v2/invite/${boxId}`)).status).toBe(404);
	});

	it("stops handing an invite out after ten reads", async () => {
		const boxId = inviteBoxId("READ1234");
		const envelope = await sealInvite("vetta://pair?v=2", "READ1234", "123456");
		expect((await put(boxId, { envelope })).status).toBe(204);
		for (let read = 0; read < 10; read += 1) {
			expect((await SELF.fetch(`https://relay.test/v2/invite/${boxId}`)).status).toBe(200);
		}
		expect((await SELF.fetch(`https://relay.test/v2/invite/${boxId}`)).status).toBe(404);
	});

	it("rejects malformed names, envelopes and methods", async () => {
		expect((await SELF.fetch("https://relay.test/v2/invite/K7Q29MXD")).status).toBe(404);
		const boxId = inviteBoxId("BAD00000");
		expect((await put(boxId, { envelope: { v: 1, nonce: "x", ciphertext: "y" } })).status).toBe(400);
		expect((await put(boxId, "not json")).status).toBe(400);
		const oversized = await SELF.fetch(`https://relay.test/v2/invite/${boxId}`, {
			method: "PUT",
			headers: { "X-Vetta-Invite-Token": token },
			body: "x".repeat(20_000),
		});
		expect(oversized.status).toBe(413);
		expect((await SELF.fetch(`https://relay.test/v2/invite/${boxId}`, { method: "POST" })).status).toBe(405);
		expect((await SELF.fetch(`https://relay.test/v2/invite/${boxId}`)).status).toBe(404);
	});
});
