import type { RuntimeSession } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import type {
	CodingAgentRuntimeExtensionEventHost,
	CodingAgentRuntimeExtensionInitialization,
} from "../../src/public-api/runtime/extensions.js";
import { createCodingAgentRuntimeExtensionSessionHost } from "../../src/public-api/runtime/extensions.js";

describe("CodingAgentExtensionSessionHost initialization rollback", () => {
	it("continues reverse rollback and keeps the reload failure as the primary cause", async () => {
		const order: string[] = [];
		const initializationError = new Error("resource discovery failed");
		const cleanupError = new Error("next host cleanup failed");
		const previousRunner = {
			emit: vi.fn(async (event: { readonly type: string }) => {
				order.push(`previous:${event.type}`);
			}),
		};
		const previous = {
			runner: previousRunner,
			initialize: vi.fn(async () => undefined),
			discoverResources: vi.fn(async () => undefined),
			rebindRuntimeActions: vi.fn(() => order.push("previous:rebind-actions")),
			rebindRuntimeBindings: vi.fn(() => order.push("previous:rebind-bindings")),
			dispose: vi.fn(async () => undefined),
		} as unknown as CodingAgentRuntimeExtensionEventHost;
		const next = {
			runner: {
				emit: vi.fn(async (event: { readonly type: string }) => {
					order.push(`next:${event.type}`);
				}),
			},
			initialize: vi.fn(async () => undefined),
			discoverResources: vi.fn(async () => {
				throw initializationError;
			}),
			dispose: vi.fn(async () => {
				order.push("next:dispose");
				throw cleanupError;
			}),
		} as unknown as CodingAgentRuntimeExtensionEventHost;
		const host = createCodingAgentRuntimeExtensionSessionHost(previous, () => next);
		await host.initialize({
			uiContext: {} as NonNullable<CodingAgentRuntimeExtensionInitialization["uiContext"]>,
			shutdownHandler: vi.fn(),
			onError: vi.fn(),
		});
		order.length = 0;

		let caught: unknown;
		try {
			await host.reload({} as RuntimeSession, async () => undefined);
		} catch (error) {
			caught = error;
		}

		expect(order).toEqual([
			"previous:session_shutdown",
			"next:session_start",
			"next:dispose",
			"previous:rebind-bindings",
			"previous:session_start",
		]);
		expect(host.readRunner()).toBe(previousRunner);
		expect(caught).toMatchObject({
			message: "Extension reload and rollback failed",
			cause: initializationError,
			errors: [initializationError, cleanupError],
		});
	});
});
