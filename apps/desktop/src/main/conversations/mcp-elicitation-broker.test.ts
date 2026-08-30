import { describe, expect, it, vi } from "vitest";
import { DesktopMcpElicitationBroker } from "./mcp-elicitation-broker.js";

describe("DesktopMcpElicitationBroker", () => {
	it("normalizes form fields and accepts only schema-valid content", async () => {
		const broker = new DesktopMcpElicitationBroker();
		const observed = vi.fn();
		broker.setInteractiveHandler(async (request) => {
			observed(request);
			return { action: "accept", content: { name: "Vetta", retries: 2, scopes: ["read"] } };
		});

		const result = await broker.handle(
			{
				message: "Configure connector",
				requestedSchema: {
					type: "object",
					required: ["name"],
					properties: {
						name: { type: "string", title: "Name", minLength: 1 },
						retries: { type: "integer", minimum: 0, maximum: 3 },
						scopes: { type: "array", items: { type: "string", enum: ["read", "write"] } },
					},
				},
			},
			{ serverName: "demo", method: "elicitation/create", round: 1, sessionId: "session-1" },
		);

		expect(result).toEqual({
			action: "accept",
			content: { name: "Vetta", retries: 2, scopes: ["read"] },
		});
		expect(observed.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({
				sessionId: "session-1",
				serverName: "demo",
				mode: "form",
				fields: expect.arrayContaining([
					expect.objectContaining({ key: "name", kind: "string", required: true }),
					expect.objectContaining({ key: "scopes", kind: "multi-select" }),
				]),
			}),
		);
		expect(broker.listPending()).toEqual([]);
	});

	it("cancels invalid renderer responses and disallowed URLs", async () => {
		const broker = new DesktopMcpElicitationBroker();
		const handler = vi.fn(async () => ({ action: "accept" as const, content: { count: 1.5 } }));
		broker.setInteractiveHandler(handler);

		await expect(
			broker.handle(
				{
					message: "Count",
					requestedSchema: {
						type: "object",
						required: ["count"],
						properties: { count: { type: "integer" } },
					},
				},
				{ serverName: "demo", method: "elicitation/create", round: 1, sessionId: "session-1" },
			),
		).resolves.toEqual({ action: "cancel" });

		await expect(
			broker.handle(
				{ mode: "url", message: "Authenticate", url: "http://example.com/callback" },
				{ serverName: "demo", method: "elicitation/create", round: 1, sessionId: "session-1" },
			),
		).resolves.toEqual({ action: "cancel" });
		expect(handler).toHaveBeenCalledOnce();
	});

	it("exposes pending requests and emits a resolved event", async () => {
		const broker = new DesktopMcpElicitationBroker();
		let finish: ((value: { action: "decline" }) => void) | undefined;
		broker.setInteractiveHandler(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const resolved = vi.fn();
		broker.onResolved(resolved);

		const pendingResult = broker.handle(
			{ mode: "url", message: "Authenticate", url: "https://example.com/authorize" },
			{ serverName: "demo", method: "elicitation/create", round: 1, sessionId: "session-1" },
		);
		expect(broker.listPending()).toHaveLength(1);
		finish?.({ action: "decline" });

		await expect(pendingResult).resolves.toEqual({ action: "decline" });
		expect(resolved).toHaveBeenCalledWith(
			expect.objectContaining({ sessionId: "session-1", requestId: expect.any(String) }),
		);
	});
});
