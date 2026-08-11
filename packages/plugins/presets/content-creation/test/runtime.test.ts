import type { PluginContext } from "@vetta-org/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { ContentCreationPluginRuntime } from "../src/plugin/runtime";

function createPluginContext() {
	const mediaSubscriptionDispose = vi.fn();
	const settingsSubscriptionDispose = vi.fn();
	const setPromptAttachment = vi.fn();
	const context = {
		media: {
			listProviders: vi.fn(async () => []),
			onProvidersChanged: vi.fn(() => ({ dispose: mediaSubscriptionDispose })),
		},
		settings: {
			onChange: vi.fn(() => ({ dispose: settingsSubscriptionDispose })),
		},
		ui: {
			notify: vi.fn(),
			setActivityPanelWidth: vi.fn(),
			setPromptAttachment,
			registerShortcutScope: vi.fn(() => ({ dispose: vi.fn() })),
		},
		i18n: { t: (key: string) => key },
		network: {},
		jobs: {},
		fs: {},
		storage: {},
		artifacts: {},
		ai: {},
	} as unknown as PluginContext;
	return {
		context,
		mediaSubscriptionDispose,
		settingsSubscriptionDispose,
		setPromptAttachment,
	};
}

describe("ContentCreationPluginRuntime", () => {
	it("keeps overlapping hot-reload activations isolated when the previous one is disposed", async () => {
		const firstContext = createPluginContext();
		const secondContext = createPluginContext();
		const first = await ContentCreationPluginRuntime.create(firstContext.context);
		const second = await ContentCreationPluginRuntime.create(secondContext.context);
		const firstGeneration = first.generation;
		const secondGeneration = second.generation;
		second.runApprovals.request("new-activation-run");

		first.dispose();

		// The old mounted tree remains render-safe until React commits the replacement.
		expect(first.generation).toBe(firstGeneration);
		expect(second.generation).toBe(secondGeneration);
		expect(second.runApprovals.getSnapshot()).toEqual(["new-activation-run"]);
		expect(firstContext.mediaSubscriptionDispose).toHaveBeenCalledOnce();
		expect(firstContext.settingsSubscriptionDispose).toHaveBeenCalledOnce();
		expect(secondContext.mediaSubscriptionDispose).not.toHaveBeenCalled();
		expect(secondContext.settingsSubscriptionDispose).not.toHaveBeenCalled();

		second.publishPromptAttachment(null);
		expect(secondContext.setPromptAttachment).toHaveBeenCalledWith(null);
		second.dispose();
	});
});
