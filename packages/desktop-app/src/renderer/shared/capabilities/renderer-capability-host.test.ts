import { bindCapability } from "@vetta/capability-runtime";
import { CAPABILITY_ERROR_CODES, createCapabilityGrant, DOMAIN_NAVIGATION_CAPABILITIES } from "@vetta/capability-sdk";
import { describe, expect, it, vi } from "vitest";
import { RendererCapabilityHost } from "./renderer-capability-host.js";

const testCapability = DOMAIN_NAVIGATION_CAPABILITIES.OPEN_HOSTED_ROUTE;
const route = { namespace: "test-routes", ownerId: "owner", pageId: "main" } as const;

describe("RendererCapabilityHost", () => {
	it("routes authorized sessions through registered Renderer providers", async () => {
		const host = new RendererCapabilityHost();
		const execute = vi.fn(async () => undefined);
		host.registerDomainProviders("test-owner", [bindCapability(testCapability, { execute })]);
		const session = host.createSession({
			subject: { id: "test-subject", sessionId: "test-session" },
			grants: [createCapabilityGrant(testCapability)],
		});

		await session.client.invoke(testCapability, route);

		expect(execute).toHaveBeenCalledExactlyOnceWith(route, expect.any(Object));
	});

	it("revokes session access without removing the host provider", async () => {
		const host = new RendererCapabilityHost();
		host.registerDomainProviders("test-owner", [bindCapability(testCapability, { execute: async () => undefined })]);
		const session = host.createSession({
			subject: { id: "test-subject", sessionId: "test-session" },
			grants: [createCapabilityGrant(testCapability)],
		});

		session.revoke();
		await expect(session.client.invoke(testCapability, route)).rejects.toMatchObject({
			code: CAPABILITY_ERROR_CODES.SESSION_REVOKED,
		});

		const nextSession = host.createSession({
			subject: { id: "next-subject", sessionId: "next-session" },
			grants: [createCapabilityGrant(testCapability)],
		});
		await expect(nextSession.client.invoke(testCapability, route)).resolves.toBeUndefined();
	});
});
