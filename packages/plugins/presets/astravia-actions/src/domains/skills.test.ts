import { describe, expect, it, vi } from "vitest";
import { registerSkillsActions } from "./skills";

type Registered = {
	id: string;
	publicId?: string;
	effect: string;
	handler: (args: { input: unknown; signal: AbortSignal }) => Promise<unknown>;
	assertReady?: (args: { input: unknown; signal: AbortSignal }) => Promise<void>;
	inputSchema: unknown;
};

function createMockCtx() {
	const registered: Registered[] = [];
	const official = {
		skills: {
			list: vi.fn().mockResolvedValue([{ name: "demo", description: "d", source: "market", type: "skill" }]),
			getManifest: vi.fn().mockResolvedValue({
				demo: {
					name: "demo",
					version: "1.0.0",
					installedAt: "2026-01-01T00:00:00.000Z",
					source: "market",
					enabled: true,
					type: "skill",
				},
			}),
			setEnabled: vi.fn().mockResolvedValue({ name: "demo", enabled: false }),
			uninstall: vi.fn().mockResolvedValue(undefined),
			installFromMarket: vi.fn().mockResolvedValue({
				name: "demo",
				type: "skill",
				version: "1.2.0",
				updated: false,
			}),
		},
	};
	const ctx = {
		official,
		appActions: {
			register: (def: Registered) => {
				registered.push(def);
			},
		},
	};
	return { ctx: ctx as never, registered, official };
}

describe("registerSkillsActions", () => {
	it("registers skills.query and skills.manage with public ids", () => {
		const { ctx, registered } = createMockCtx();
		registerSkillsActions(ctx);
		expect(registered.map((item) => item.publicId)).toEqual(["skills.query", "skills.manage"]);
		expect(registered.every((item) => item.effect === "read" || item.effect === "write")).toBe(true);
	});

	it("query list and manifest call official skills api", async () => {
		const { ctx, registered, official } = createMockCtx();
		registerSkillsActions(ctx);
		const query = registered.find((item) => item.id === "skills.query");
		expect(query).toBeDefined();
		const signal = new AbortController().signal;
		await expect(query?.handler({ input: { operation: "list" }, signal })).resolves.toEqual([
			{ name: "demo", description: "d", source: "market", type: "skill" },
		]);
		await expect(query?.handler({ input: { operation: "manifest" }, signal })).resolves.toMatchObject({
			demo: expect.objectContaining({ name: "demo" }),
		});
		expect(official.skills.list).toHaveBeenCalled();
		expect(official.skills.getManifest).toHaveBeenCalled();
	});

	it("manage install-from-market installs via official api", async () => {
		const { ctx, registered, official } = createMockCtx();
		registerSkillsActions(ctx);
		const manage = registered.find((item) => item.id === "skills.manage");
		expect(manage).toBeDefined();
		const signal = new AbortController().signal;
		const input = { operation: "install-from-market" as const, type: "skill" as const, slug: "demo" };
		await manage?.assertReady?.({ input, signal });
		await expect(manage?.handler({ input, signal })).resolves.toEqual({
			operation: "install-from-market",
			name: "demo",
			type: "skill",
			version: "1.2.0",
			updated: false,
		});
		expect(official.skills.installFromMarket).toHaveBeenCalledWith("skill", "demo");
	});

	it("manage set-enabled and uninstall require installed name", async () => {
		const { ctx, registered, official } = createMockCtx();
		registerSkillsActions(ctx);
		const manage = registered.find((item) => item.id === "skills.manage");
		const signal = new AbortController().signal;
		await expect(
			manage?.assertReady?.({ input: { operation: "set-enabled", name: "missing", enabled: true }, signal }),
		).rejects.toMatchObject({ code: "ACTION_NOT_FOUND" });
		await manage?.assertReady?.({ input: { operation: "set-enabled", name: "demo", enabled: false }, signal });
		await expect(
			manage?.handler({ input: { operation: "set-enabled", name: "demo", enabled: false }, signal }),
		).resolves.toMatchObject({ operation: "set-enabled", name: "demo", enabled: false });
		expect(official.skills.setEnabled).toHaveBeenCalledWith("demo", false);
	});
});
