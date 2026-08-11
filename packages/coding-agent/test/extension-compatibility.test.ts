import { describe, expect, it } from "vitest";
import {
	CODING_AGENT_EXTENSION_HOST_SUPPORTED_EVENTS,
	type CodingAgentExtensionEventCompatibilityProfile,
	collectCodingAgentExtensionRequirements,
	resolveCodingAgentExtensionCompatibility,
} from "../src/host/extensions/compatibility/index.js";

const EXTENSION_EVENT_PROFILE = {
	input: "supported",
	before_agent_start: "supported",
	resources_discover: "supported",
	session_start: "supported",
	session_shutdown: "supported",
	session_before_switch: "supported",
	session_switch: "supported",
	session_before_fork: "supported",
	session_fork: "supported",
	session_before_tree: "supported",
	session_tree: "supported",
	session_before_compact: "supported",
	session_compact: "supported",
	agent_start: "supported",
	agent_end: "supported",
	turn_start: "supported",
	turn_end: "supported",
	message_start: "supported",
	message_update: "supported",
	message_end: "supported",
	context: "supported",
	tool_call: "supported",
	tool_result: "supported",
	tool_execution_start: "supported",
	tool_execution_update: "supported",
	tool_execution_phase: "supported",
	tool_execution_end: "supported",
	model_select: "supported",
	user_bash: "unsupported",
} as const satisfies CodingAgentExtensionEventCompatibilityProfile;

const EXTENSION_HOST_CAPABILITIES = {
	runtimeActions: true,
	eventProfile: EXTENSION_EVENT_PROFILE,
} as const;

describe("Coding Agent Extension compatibility assessment", () => {
	it("keeps the supported event export aligned with the exhaustive compatibility profile", () => {
		expect([...CODING_AGENT_EXTENSION_HOST_SUPPORTED_EVENTS].sort()).toEqual(
			Object.entries(EXTENSION_EVENT_PROFILE)
				.filter(([, status]) => status === "supported")
				.map(([event]) => event)
				.sort(),
		);
	});

	it("reports no runtime requirement when no Extension is loaded", () => {
		expect(
			collectCodingAgentExtensionRequirements({
				extensions: [],
				pendingProviderNames: [],
			}),
		).toEqual({
			extensionCount: 0,
			bootstrapContributions: {
				providers: [],
				flags: [],
			},
			registrations: [],
			requiredRuntimeCapabilities: [],
		});
	});

	it("separates bootstrap contributions from registered runtime capabilities", () => {
		const requirements = collectCodingAgentExtensionRequirements({
			extensions: [
				{
					path: "z-extension.ts",
					handlers: new Map([
						["turn_end", [async () => undefined]],
						["agent_start", [async () => undefined]],
						["unused", []],
					]),
					tools: new Map([["write_report", {}]]),
					commands: new Map([["report", {}]]),
					shortcuts: new Map([["ctrl+r", {}]]),
					flags: new Map([
						["verbose-report", {}],
						["report-format", {}],
					]),
					messageRenderers: new Map([["report-card", {}]]),
				},
				{
					path: "a-extension.ts",
					handlers: new Map(),
					tools: new Map(),
					commands: new Map(),
					shortcuts: new Map(),
					flags: new Map([["report-format", {}]]),
					messageRenderers: new Map(),
				},
			],
			pendingProviderNames: ["z-provider", "a-provider", "z-provider"],
		});

		expect(requirements).toEqual({
			extensionCount: 2,
			bootstrapContributions: {
				providers: ["a-provider", "z-provider"],
				flags: ["report-format", "verbose-report"],
			},
			registrations: [
				{
					path: "a-extension.ts",
					events: [],
					tools: [],
					commands: [],
					shortcuts: [],
					flags: ["report-format"],
					messageRenderers: [],
				},
				{
					path: "z-extension.ts",
					events: ["agent_start", "turn_end"],
					tools: ["write_report"],
					commands: ["report"],
					shortcuts: ["ctrl+r"],
					flags: ["report-format", "verbose-report"],
					messageRenderers: ["report-card"],
				},
			],
			requiredRuntimeCapabilities: [
				"opaque-runtime-api",
				"event-handler",
				"tool",
				"command",
				"shortcut",
				"message-renderer",
			],
		});
	});

	it("allows bootstrap-only registrations after the Greenfield Action Host closes the opaque API gap", () => {
		const requirements = collectCodingAgentExtensionRequirements({
			extensions: [
				{
					path: "bootstrap-extension.ts",
					handlers: new Map(),
					tools: new Map(),
					commands: new Map(),
					shortcuts: new Map(),
					flags: new Map([["custom-endpoint", {}]]),
					messageRenderers: new Map(),
				},
			],
			pendingProviderNames: ["custom-provider"],
		});

		expect(requirements.bootstrapContributions).toEqual({
			providers: ["custom-provider"],
			flags: ["custom-endpoint"],
		});
		expect(requirements.requiredRuntimeCapabilities).toEqual(["opaque-runtime-api"]);
		expect(resolveCodingAgentExtensionCompatibility(requirements, EXTENSION_HOST_CAPABILITIES)).toMatchObject({
			requiredRuntimeCapabilities: ["opaque-runtime-api"],
			unmetRuntimeCapabilities: [],
			unsupportedEvents: [],
			compatible: true,
		});
	});

	it("allows the lossless input, lifecycle and tool events implemented by the Greenfield event host", () => {
		const requirements = collectCodingAgentExtensionRequirements({
			extensions: [
				{
					path: "supported-events.ts",
					handlers: new Map([
						["input", [async () => undefined]],
						["before_agent_start", [async () => undefined]],
						["session_start", [async () => undefined]],
						["session_shutdown", [async () => undefined]],
						["session_before_compact", [async () => undefined]],
						["session_compact", [async () => undefined]],
						["agent_start", [async () => undefined]],
						["agent_end", [async () => undefined]],
						["turn_start", [async () => undefined]],
						["turn_end", [async () => undefined]],
						["message_start", [async () => undefined]],
						["message_update", [async () => undefined]],
						["message_end", [async () => undefined]],
						["tool_call", [async () => undefined]],
						["tool_result", [async () => undefined]],
						["tool_execution_start", [async () => undefined]],
						["tool_execution_update", [async () => undefined]],
						["tool_execution_phase", [async () => undefined]],
						["tool_execution_end", [async () => undefined]],
						["model_select", [async () => undefined]],
						["resources_discover", [async () => undefined]],
					]),
					tools: new Map(),
					commands: new Map(),
					shortcuts: new Map(),
					flags: new Map(),
					messageRenderers: new Map(),
				},
			],
			pendingProviderNames: [],
		});

		expect(resolveCodingAgentExtensionCompatibility(requirements, EXTENSION_HOST_CAPABILITIES)).toMatchObject({
			unmetRuntimeCapabilities: [],
			unsupportedEvents: [],
			compatible: true,
		});
	});

	it("distinguishes host-inapplicable registrations from unsupported runtime gaps", () => {
		const requirements = collectCodingAgentExtensionRequirements({
			extensions: [
				{
					path: "rpc-ui-extension.ts",
					handlers: new Map([
						["user_bash", [async () => undefined]],
						["unknown_event", [async () => undefined]],
					]),
					tools: new Map(),
					commands: new Map(),
					shortcuts: new Map([["ctrl+r", {}]]),
					flags: new Map(),
					messageRenderers: new Map([["report-card", {}]]),
				},
			],
			pendingProviderNames: [],
		});

		expect(
			resolveCodingAgentExtensionCompatibility(requirements, {
				...EXTENSION_HOST_CAPABILITIES,
				eventProfile: {
					...EXTENSION_EVENT_PROFILE,
					user_bash: "inapplicable",
				},
				inapplicableRuntimeCapabilities: ["shortcut", "message-renderer"],
			}),
		).toMatchObject({
			inapplicableRuntimeCapabilities: ["shortcut", "message-renderer"],
			unmetRuntimeCapabilities: ["event-handler"],
			inapplicableEvents: ["user_bash"],
			unsupportedEvents: ["unknown_event"],
			compatible: false,
		});
	});

	it("allows the historical context transformation event after lossless context projection", () => {
		const requirements = collectCodingAgentExtensionRequirements({
			extensions: [
				{
					path: "event-extension.ts",
					handlers: new Map([
						["input", [async () => undefined]],
						["context", [async () => undefined]],
						["agent_end", [async () => undefined]],
						["message_end", [async () => undefined]],
					]),
					tools: new Map(),
					commands: new Map(),
					shortcuts: new Map(),
					flags: new Map(),
					messageRenderers: new Map(),
				},
			],
			pendingProviderNames: [],
		});

		expect(resolveCodingAgentExtensionCompatibility(requirements, EXTENSION_HOST_CAPABILITIES)).toMatchObject({
			unmetRuntimeCapabilities: [],
			unsupportedEvents: [],
			compatible: true,
		});
	});

	it("only closes the Extension Tool capability when the host installs the tool runtime", () => {
		const requirements = collectCodingAgentExtensionRequirements({
			extensions: [
				{
					path: "tool-extension.ts",
					handlers: new Map(),
					tools: new Map([["extension_echo", {}]]),
					commands: new Map([["echo", {}]]),
					shortcuts: new Map(),
					flags: new Map(),
					messageRenderers: new Map(),
				},
			],
			pendingProviderNames: [],
		});

		expect(
			resolveCodingAgentExtensionCompatibility(requirements, {
				...EXTENSION_HOST_CAPABILITIES,
				tools: true,
			}),
		).toMatchObject({
			unmetRuntimeCapabilities: ["command"],
			compatible: false,
		});
	});
});
