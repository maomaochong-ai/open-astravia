import type { ExtensionAPI, ExtensionFactory } from "../api-contracts.js";
import type {
	PiCompatibleExtensionAPI,
	PiCompatibleExtensionFactory,
	PiExtensionCompatibilityFeature,
} from "./contracts.js";
import { PiExtensionCompatibilityError } from "./contracts.js";
import { adaptPiToolDefinition } from "./tool-adapter.js";

const SUPPORTED_PI_EVENTS = new Set([
	"resources_discover",
	"session_before_switch",
	"session_before_tree",
	"session_tree",
	"context",
	"agent_start",
	"agent_end",
	"turn_start",
	"turn_end",
	"message_start",
	"message_update",
	"message_end",
	"tool_execution_start",
	"tool_execution_update",
	"tool_execution_end",
	"model_select",
	"tool_call",
	"tool_result",
	"user_bash",
	"input",
]);

export function adaptPiExtensionFactory(
	factory: PiCompatibleExtensionFactory,
	recordFeature: (feature: PiExtensionCompatibilityFeature) => void,
): ExtensionFactory {
	return async (api) => {
		await factory(createPiApi(api, recordFeature));
	};
}

function createPiApi(
	api: ExtensionAPI,
	recordFeature: (feature: PiExtensionCompatibilityFeature) => void,
): PiCompatibleExtensionAPI {
	const adaptedApi: PiCompatibleExtensionAPI = {
		events: undefined,
		on(event, handler): void {
			if (!SUPPORTED_PI_EVENTS.has(event)) {
				throw unsupported(`event:${event}`, `Pi event '${event}' has no equivalent settled Vetta fact`);
			}
			recordFeature({
				feature: `event:${event}`,
				status: "host-dependent",
				detail: "Payload uses the native Vetta event pipeline; handler context is limited to the shared subset",
			});
			const register = api.on as unknown as (
				eventType: string,
				eventHandler: (...args: unknown[]) => unknown,
			) => void;
			register(event, handler);
		},
		registerTool(tool): void {
			const adapted = adaptPiToolDefinition(tool);
			for (const feature of adapted.features) recordFeature(feature);
			api.registerTool(adapted.definition);
		},
		registerShortcut(shortcut): void {
			recordFeature({
				feature: `shortcut:${shortcut}`,
				status: "excluded",
				detail: "Pi terminal shortcuts are outside the host-neutral compatibility profile",
			});
		},
		registerFlag(name): void {
			throw unsupported(
				`flag:${name}`,
				`Pi flag '${name}' is disabled until Extension registration publishes atomically`,
			);
		},
		getFlag(name): never {
			throw unsupported(`flag:${name}`, `Pi flag '${name}' is unavailable in this compatibility profile`);
		},
		registerMessageRenderer(customType): void {
			recordFeature({
				feature: `message-renderer:${customType}`,
				status: "excluded",
				detail: "Pi TUI message renderers are outside the host-neutral compatibility profile",
			});
		},
		registerProvider(name): void {
			throw unsupported(
				`provider:${name}`,
				`Pi provider '${name}' is disabled until Vetta provider ownership and unregister semantics are available`,
			);
		},
	};
	return new Proxy(adaptedApi, {
		get(target, property, receiver) {
			if (property === "events") {
				throw unsupported(
					"api:events",
					"Pi event bus is disabled until subscriptions have generation-owned teardown",
				);
			}
			if (typeof property === "string" && !(property in target)) {
				throw unsupported(`api:${property}`, `Pi Extension API '${property}' is not supported by this profile`);
			}
			return Reflect.get(target, property, receiver);
		},
	});
}

function unsupported(feature: string, message: string): PiExtensionCompatibilityError {
	return new PiExtensionCompatibilityError(feature, message);
}
