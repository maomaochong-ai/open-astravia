import { describe, expect, it } from "vitest";
import { PLUGIN_SYSTEM_CHANNELS } from "./plugin-capability-ipc.js";
import {
	PLUGIN_CONTRIBUTION_CHANNELS,
	PLUGIN_EXECUTION_CHANNELS,
	PLUGIN_MANAGEMENT_CHANNELS,
	PLUGIN_MEDIA_CHANNELS,
} from "./plugin-ipc.js";

describe("plugin IPC channels", () => {
	it("keeps handler channels unique", () => {
		const contributionEventChannels: ReadonlySet<string> = new Set([
			PLUGIN_CONTRIBUTION_CHANNELS.TOOL_REQUEST,
			PLUGIN_CONTRIBUTION_CHANNELS.HOOK_REQUEST,
			PLUGIN_CONTRIBUTION_CHANNELS.APP_ACTION_REQUEST,
			PLUGIN_CONTRIBUTION_CHANNELS.APP_ACTION_CANCEL,
			PLUGIN_CONTRIBUTION_CHANNELS.CONTINUATION_REQUEST,
			PLUGIN_CONTRIBUTION_CHANNELS.SYSTEM_PROMPT_REQUEST,
			PLUGIN_CONTRIBUTION_CHANNELS.SETTINGS_CHANGED,
			PLUGIN_CONTRIBUTION_CHANNELS.PLUGINS_CHANGED,
		]);
		const mediaEventChannels: ReadonlySet<string> = new Set([
			PLUGIN_MEDIA_CHANNELS.REQUEST,
			PLUGIN_MEDIA_CHANNELS.CHANGED,
		]);
		const handlerChannels = [
			...Object.values(PLUGIN_MANAGEMENT_CHANNELS),
			...Object.values(PLUGIN_SYSTEM_CHANNELS),
			...Object.values(PLUGIN_EXECUTION_CHANNELS).filter(
				(channel) => channel !== PLUGIN_EXECUTION_CHANNELS.COMMAND_SPAWN_EXIT,
			),
			...Object.values(PLUGIN_CONTRIBUTION_CHANNELS).filter((channel) => !contributionEventChannels.has(channel)),
			...Object.values(PLUGIN_MEDIA_CHANNELS).filter((channel) => !mediaEventChannels.has(channel)),
		];

		expect(new Set(handlerChannels).size).toBe(handlerChannels.length);
	});
});
