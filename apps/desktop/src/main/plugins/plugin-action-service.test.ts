import type { WebContents } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginAppActionRegistration } from "../../preload/api-types/plugins.js";
import { AppActionCatalog } from "../app-actions/catalog.js";
import { PluginActionService } from "./plugin-action-service.js";

const pluginState = vi.hoisted(() => ({ enabled: true }));
const logger = vi.hoisted(() => ({
	debug: vi.fn(),
	error: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
}));

vi.mock("../logger.js", () => ({
	getAppLogger: () => logger,
}));

vi.mock("./plugin-catalog.js", () => ({
	CORE_ACTION_PLUGIN_ID: "vetta-actions",
	getPluginSettings: () => ({}),
	listPlugins: () => [
		{
			id: "action-provider",
			enabled: pluginState.enabled,
			permissions: ["app.actions.register", "app.actionHandler.execute"],
			grantedPermissions: ["app.actions.register", "app.actionHandler.execute"],
			trustLevel: "community",
		},
	],
}));

interface SentMessage {
	readonly channel: string;
	readonly payload: unknown;
}

function createRegisteredAction(usage?: PluginAppActionRegistration["usage"]): {
	readonly catalog: AppActionCatalog;
	readonly sent: SentMessage[];
	readonly service: PluginActionService;
} {
	const sent: SentMessage[] = [];
	const webContents = {
		isDestroyed: () => false,
		send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
	} as unknown as WebContents;
	const catalog = new AppActionCatalog();
	const service = new PluginActionService(webContents, catalog);
	const activationId = "activation";
	const registration: PluginAppActionRegistration = {
		id: "read",
		title: "Read",
		summary: "Read data",
		usage,
		effect: "read",
		inputSchema: { type: "object", additionalProperties: false },
		examples: [],
		handlerId: "handler",
		activationId,
		hasAssertReady: false,
	};
	service.beginLoad("action-provider", activationId);
	service.register("action-provider", registration);
	service.commit("action-provider", activationId);
	return { catalog, sent, service };
}

function requirePayload(message: SentMessage | undefined): Record<string, unknown> {
	if (typeof message?.payload !== "object" || message.payload === null || Array.isArray(message.payload)) {
		throw new Error("Expected plugin action request payload");
	}
	return message.payload as Record<string, unknown>;
}

describe("PluginActionService provider identity", () => {
	beforeEach(() => {
		pluginState.enabled = true;
		vi.clearAllMocks();
	});

	it("records one aggregate activation result with count and duration", () => {
		createRegisteredAction();

		expect(logger.info).toHaveBeenCalledWith("activation committed", {
			pluginId: "action-provider",
			activationId: "activation",
			actionCount: 1,
			durationMs: expect.any(Number),
		});
		expect(logger.info).not.toHaveBeenCalledWith("action registered", expect.anything());
	});

	it("preserves routing metadata through registration, search and describe without invoking the handler", () => {
		const usage = {
			target: "Notes in this plugin",
			useWhen: "Read notes from this plugin",
			avoidWhen: "Do not use for repository files",
			alternatives: "Use file tools for repository files",
		};
		const { catalog, sent } = createRegisteredAction(usage);
		expect(catalog.describe("plugin.action-provider.read").usage).toEqual(usage);
		expect(catalog.search({ query: "Read" })[0]?.usage).toEqual(usage);
		expect(catalog.search({ query: "repository" })).toEqual([]);
		expect(sent).toEqual([]);
	});

	it("does not forward action caller identity to the plugin provider", async () => {
		const { catalog, sent, service } = createRegisteredAction();
		const result = Promise.resolve(
			catalog.get("plugin.action-provider.read").run(
				{},
				{
					source: "local-server",
					requestId: "caller-request",
				},
			),
		);
		const payload = requirePayload(sent[0]);

		expect(sent[0]?.channel).toBe("vetta:plugins:app-action-request");
		expect(payload.pluginId).toBe("action-provider");
		expect(payload.requestId).not.toBe("caller-request");
		expect(payload).not.toHaveProperty("source");
		expect(payload).not.toHaveProperty("capabilitySessionId");

		service.respond(String(payload.requestId), { value: { ok: true } });
		await expect(result).resolves.toEqual({ ok: true });
	});

	it("rejects invocation when the provider plugin is disabled", () => {
		const { catalog } = createRegisteredAction();
		pluginState.enabled = false;

		expect(() => catalog.get("plugin.action-provider.read").run({}, { source: "internal" })).toThrowError(
			expect.objectContaining({ code: "PLUGIN_ACTION_UNAVAILABLE" }),
		);
	});
});
