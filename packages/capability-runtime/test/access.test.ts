import {
	CAPABILITY_CONSTRAINT_KINDS,
	CAPABILITY_ERROR_CODES,
	createCapabilityGrant,
	type FilesystemReadFileResult,
	FOUNDATION_FILESYSTEM_CAPABILITIES,
	FOUNDATION_STORAGE_CAPABILITIES,
} from "@vetta/capability-sdk";
import { describe, expect, it } from "vitest";
import { type CapabilityAccessAuditEvent, CapabilityAccessController } from "../src/access.js";
import { CapabilityHub } from "../src/hub.js";
import { bindCapability } from "../src/provider.js";

const NAMESPACED_CAPABILITY = FOUNDATION_STORAGE_CAPABILITIES.GET_ALL;

function createAccess(audit?: (event: CapabilityAccessAuditEvent) => void): CapabilityAccessController {
	const hub = new CapabilityHub();
	hub.foundation.registerOwner("test", [
		bindCapability(NAMESPACED_CAPABILITY, {
			execute: ({ namespace }) => ({ namespace }),
		}),
	]);
	return new CapabilityAccessController(hub, { audit });
}

describe("CapabilityAccessController", () => {
	it("supports more than ten concurrent session invocations without listener warnings", async () => {
		const warnings: Error[] = [];
		const onWarning = (warning: Error): void => {
			if (warning.name === "MaxListenersExceededWarning" && warning.message.includes("abort listeners")) {
				warnings.push(warning);
			}
		};
		process.on("warning", onWarning);

		const hub = new CapabilityHub();
		const readFileCapability = FOUNDATION_FILESYSTEM_CAPABILITIES.READ_FILE;
		hub.foundation.registerOwner("concurrency", [
			bindCapability(readFileCapability, {
				execute: (_input, executionContext) =>
					new Promise<FilesystemReadFileResult>((_resolve, reject) => {
						executionContext.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
					}),
			}),
		]);
		const access = new CapabilityAccessController(hub);
		const handle = access.createSession({
			subject: { id: "subject", sessionId: "concurrency" },
			grants: [createCapabilityGrant(readFileCapability)],
		});
		const invocations = Array.from({ length: 11 }, (_, index) =>
			handle.client.invoke(readFileCapability, { path: `value-${index}` }),
		);

		try {
			await new Promise<void>((resolve) => setImmediate(resolve));
			handle.revoke();
			await Promise.allSettled(invocations);
			await new Promise<void>((resolve) => setImmediate(resolve));
		} finally {
			process.off("warning", onWarning);
			handle.revoke();
		}

		expect(warnings).toEqual([]);
	});

	it("requires an exact grant and enforces namespace constraints", async () => {
		const audit: CapabilityAccessAuditEvent[] = [];
		const access = createAccess((event) => audit.push(event));
		const handle = access.createSession({
			subject: { id: "subject", sessionId: "session" },
			grants: [
				createCapabilityGrant(NAMESPACED_CAPABILITY, {
					constraints: [{ kind: CAPABILITY_CONSTRAINT_KINDS.NAMESPACE, value: "allowed" }],
				}),
			],
		});

		await expect(handle.client.invoke(NAMESPACED_CAPABILITY, { namespace: "allowed" })).resolves.toEqual({
			namespace: "allowed",
		});
		await expect(handle.client.invoke(NAMESPACED_CAPABILITY, { namespace: "denied" })).rejects.toMatchObject({
			code: CAPABILITY_ERROR_CODES.INVALID_CONSTRAINT,
		});
		await expect(
			handle.client.invoke(FOUNDATION_STORAGE_CAPABILITIES.SET, {
				namespace: "allowed",
				key: "key",
				value: true,
			}),
		).rejects.toMatchObject({
			code: CAPABILITY_ERROR_CODES.ACCESS_DENIED,
		});
		expect(audit.map(({ decision, reason }) => ({ decision, reason }))).toEqual([
			{ decision: "allow", reason: "granted" },
			{ decision: "deny", reason: "invalid-constraint" },
			{ decision: "deny", reason: "missing-grant" },
		]);
	});

	it("rejects revoked and expired sessions", async () => {
		const access = createAccess();
		const revoked = access.createSession({
			subject: { id: "subject", sessionId: "revoked" },
			grants: [createCapabilityGrant(NAMESPACED_CAPABILITY)],
		});
		revoked.revoke();

		await expect(revoked.client.invoke(NAMESPACED_CAPABILITY, { namespace: "value" })).rejects.toMatchObject({
			code: CAPABILITY_ERROR_CODES.SESSION_REVOKED,
		});

		const expired = access.createSession({
			subject: { id: "subject", sessionId: "expired" },
			grants: [createCapabilityGrant(NAMESPACED_CAPABILITY)],
			expiresAt: Date.now() - 1,
		});
		await expect(expired.client.invoke(NAMESPACED_CAPABILITY, { namespace: "value" })).rejects.toMatchObject({
			code: CAPABILITY_ERROR_CODES.SESSION_EXPIRED,
		});

		const expiredGrant = access.createSession({
			subject: { id: "subject", sessionId: "expired-grant" },
			grants: [createCapabilityGrant(NAMESPACED_CAPABILITY, { expiresAt: Date.now() - 1 })],
		});
		await expect(expiredGrant.client.invoke(NAMESPACED_CAPABILITY, { namespace: "value" })).rejects.toMatchObject({
			code: CAPABILITY_ERROR_CODES.ACCESS_DENIED,
		});
	});

	it("propagates request and session cancellation", async () => {
		const immediateAccess = createAccess();
		const immediateHandle = immediateAccess.createSession({
			subject: { id: "subject", sessionId: "request-abort" },
			grants: [createCapabilityGrant(NAMESPACED_CAPABILITY)],
		});
		const requestController = new AbortController();
		requestController.abort();
		await expect(
			immediateHandle.client.invoke(
				NAMESPACED_CAPABILITY,
				{ namespace: "value" },
				{ signal: requestController.signal },
			),
		).rejects.toMatchObject({ code: CAPABILITY_ERROR_CODES.ABORTED });

		const hub = new CapabilityHub();
		const readFileCapability = FOUNDATION_FILESYSTEM_CAPABILITIES.READ_FILE;
		hub.foundation.registerOwner("cancellation", [
			bindCapability(readFileCapability, {
				execute: (_input, executionContext) =>
					new Promise<FilesystemReadFileResult>((_resolve, reject) => {
						executionContext.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
					}),
			}),
		]);
		const access = new CapabilityAccessController(hub);
		const handle = access.createSession({
			subject: { id: "subject", sessionId: "session-abort" },
			grants: [createCapabilityGrant(readFileCapability)],
		});
		const invocation = handle.client.invoke(readFileCapability, { path: "value" });

		handle.revoke();

		await expect(invocation).rejects.toMatchObject({ code: CAPABILITY_ERROR_CODES.ABORTED });
	});
});
