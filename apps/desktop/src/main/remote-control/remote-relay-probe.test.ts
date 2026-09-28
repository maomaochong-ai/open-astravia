import { describe, expect, it } from "vitest";
import { probeRemoteRelay } from "./remote-relay-probe.js";

function relay(routes: Record<string, () => Response>): typeof fetch {
	return (async (input: string | URL | Request, init?: RequestInit) => {
		const key = `${init?.method ?? "GET"} ${String(input)}`;
		const route = routes[key];
		if (!route) throw new Error(`unexpected ${key}`);
		return route();
	}) as typeof fetch;
}

const HEALTH = "GET https://relay.test/health";
const MAILBOX = `POST https://relay.test/v2/invite/${"A".repeat(43)}`;

describe("probeRemoteRelay", () => {
	it("tells a current relay from an older one, another protocol, and silence", async () => {
		const healthy = () => Response.json({ status: "ok", protocolVersion: 2 });
		await expect(
			probeRemoteRelay(
				"wss://relay.test",
				relay({ [HEALTH]: healthy, [MAILBOX]: () => new Response(null, { status: 405 }) }),
			),
		).resolves.toBe("ok");
		await expect(
			probeRemoteRelay(
				"wss://relay.test",
				relay({ [HEALTH]: healthy, [MAILBOX]: () => Response.json({}, { status: 404 }) }),
			),
		).resolves.toBe("noInviteCodes");
		await expect(
			probeRemoteRelay(
				"wss://relay.test",
				relay({ [HEALTH]: () => Response.json({ status: "ok", protocolVersion: 1 }) }),
			),
		).resolves.toBe("incompatible");
		await expect(probeRemoteRelay("wss://relay.test", relay({}))).resolves.toBe("unreachable");
	});
});
