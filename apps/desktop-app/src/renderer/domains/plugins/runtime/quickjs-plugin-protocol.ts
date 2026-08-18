import type {
	PluginDeclarativeActionEvent,
	PluginDeclarativeNode,
	PluginQuickJsActivityTab,
} from "@vetta-org/plugin-sdk";

export type QuickJsHostMethod =
	| "network.request"
	| "storage.readJson"
	| "storage.writeJson"
	| "storage.list"
	| "storage.readFile"
	| "storage.writeFile"
	| "storage.putBlob"
	| "storage.readBlob"
	| "storage.getBlobRef"
	| "i18n.t";

export type QuickJsWorkerInboundMessage =
	| {
			type: "initialize";
			plugin: { id: string; version: string; iconUrl?: string };
			permissions: string[];
			settings: Record<string, unknown>;
			locale: string;
			code: string;
			filename: string;
	  }
	| { type: "action"; event: PluginDeclarativeActionEvent }
	| { type: "hostResponse"; callId: number; ok: boolean; value: unknown }
	| { type: "settingsChanged"; values: Record<string, unknown> }
	| { type: "localeChanged"; locale: string }
	| { type: "dispose" };

export type QuickJsWorkerOutboundMessage =
	| { type: "ready" }
	| { type: "disposed" }
	| { type: "registerActivityTab"; contribution: PluginQuickJsActivityTab }
	| { type: "updateActivityTab"; tabId: string; view: PluginDeclarativeNode }
	| { type: "openActivityTab"; tabId: string; width?: number | "max" }
	| { type: "setActivityTabVisible"; tabId: string; visible: boolean }
	| {
			type: "notify";
			options: {
				message: string;
				title?: string;
				variant?: "info" | "success" | "warning" | "error";
				durationMs?: number;
			};
	  }
	| { type: "hostCall"; callId: number; method: QuickJsHostMethod; args: unknown[] }
	| { type: "error"; message: string };

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SCENARIOS = new Set(["im-claw", "conversation", "project", "batch", "automation", "kb-processing", "cli"]);
const HOST_METHODS = new Set<QuickJsHostMethod>([
	"network.request",
	"storage.readJson",
	"storage.writeJson",
	"storage.list",
	"storage.readFile",
	"storage.writeFile",
	"storage.putBlob",
	"storage.readBlob",
	"storage.getBlobRef",
	"i18n.t",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string, maxLength = 4096): string {
	if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
		throw new Error(`Invalid QuickJS ${field}`);
	}
	return value;
}

function optionalString(value: unknown, field: string, maxLength = 4096): string | undefined {
	if (value === undefined) return undefined;
	return requiredString(value, field, maxLength);
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw new Error(`Invalid QuickJS ${field}`);
	return value;
}

function actionId(value: unknown): string {
	const id = requiredString(value, "action", 64);
	if (!IDENTIFIER_PATTERN.test(id)) throw new Error("Invalid QuickJS action");
	return id;
}

function assertAllowed<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`Invalid QuickJS ${field}`);
	return value as T;
}

function parseNode(value: unknown, budget: { count: number }, depth: number): PluginDeclarativeNode {
	if (!isRecord(value) || typeof value.type !== "string" || depth > 20 || budget.count >= 500) {
		throw new Error("Invalid QuickJS declarative view");
	}
	budget.count += 1;
	const disabled = optionalBoolean(value.disabled, "node.disabled");
	switch (value.type) {
		case "stack": {
			if (!Array.isArray(value.children)) throw new Error("Invalid QuickJS stack.children");
			return {
				type: "stack",
				direction: assertAllowed(value.direction, ["vertical", "horizontal"], "stack.direction"),
				gap: assertAllowed(value.gap, ["small", "medium", "large"], "stack.gap"),
				children: value.children.map((child) => parseNode(child, budget, depth + 1)),
			};
		}
		case "section": {
			if (!Array.isArray(value.children)) throw new Error("Invalid QuickJS section.children");
			return {
				type: "section",
				title: optionalString(value.title, "section.title", 256),
				description: optionalString(value.description, "section.description"),
				children: value.children.map((child) => parseNode(child, budget, depth + 1)),
			};
		}
		case "text":
			return {
				type: "text",
				text: requiredString(value.text, "text.text", 16_384),
				style: assertAllowed(value.style, ["body", "heading", "caption", "code"], "text.style"),
				tone: assertAllowed(value.tone, ["default", "muted", "success", "warning", "danger"], "text.tone"),
			};
		case "button":
			return {
				type: "button",
				label: requiredString(value.label, "button.label", 256),
				action: actionId(value.action),
				variant: assertAllowed(value.variant, ["primary", "secondary", "outline", "destructive"], "button.variant"),
				disabled,
			};
		case "input":
			return {
				type: "input",
				action: actionId(value.action),
				label: optionalString(value.label, "input.label", 256),
				value: optionalString(value.value, "input.value", 16_384),
				placeholder: optionalString(value.placeholder, "input.placeholder", 512),
				inputType: assertAllowed(value.inputType, ["text", "password", "number"], "input.inputType"),
				disabled,
			};
		case "textarea":
			return {
				type: "textarea",
				action: actionId(value.action),
				label: optionalString(value.label, "textarea.label", 256),
				value: optionalString(value.value, "textarea.value", 65_536),
				placeholder: optionalString(value.placeholder, "textarea.placeholder", 512),
				disabled,
			};
		case "select": {
			if (!Array.isArray(value.options) || value.options.length > 100) {
				throw new Error("Invalid QuickJS select.options");
			}
			return {
				type: "select",
				action: actionId(value.action),
				label: optionalString(value.label, "select.label", 256),
				value: optionalString(value.value, "select.value", 1024),
				placeholder: optionalString(value.placeholder, "select.placeholder", 512),
				options: value.options.map((option) => {
					if (!isRecord(option)) throw new Error("Invalid QuickJS select option");
					return {
						value: requiredString(option.value, "select option value", 1024),
						label: requiredString(option.label, "select option label", 256),
					};
				}),
				disabled,
			};
		}
		case "switch":
			return {
				type: "switch",
				action: actionId(value.action),
				label: requiredString(value.label, "switch.label", 256),
				checked: optionalBoolean(value.checked, "switch.checked"),
				disabled,
			};
		case "divider":
			return { type: "divider" };
		default:
			throw new Error("Invalid QuickJS declarative node type");
	}
}

export function parseQuickJsDeclarativeNode(value: unknown): PluginDeclarativeNode {
	return parseNode(value, { count: 0 }, 0);
}

function parseActivityTab(value: unknown): PluginQuickJsActivityTab {
	if (!isRecord(value)) throw new Error("Invalid QuickJS activity tab");
	const id = requiredString(value.id, "activity tab id", 64);
	if (!IDENTIFIER_PATTERN.test(id)) throw new Error("Invalid QuickJS activity tab id");
	let scope_use: PluginQuickJsActivityTab["scope_use"];
	if (value.scope_use !== undefined) {
		if (!Array.isArray(value.scope_use) || !value.scope_use.every((item) => SCENARIOS.has(String(item)))) {
			throw new Error("Invalid QuickJS activity tab scope_use");
		}
		scope_use = value.scope_use as PluginQuickJsActivityTab["scope_use"];
	}
	return {
		id,
		label: requiredString(value.label, "activity tab label", 256),
		view: parseQuickJsDeclarativeNode(value.view),
		scope_use,
		initiallyVisible: optionalBoolean(value.initiallyVisible, "activity tab initiallyVisible"),
		retention: assertAllowed(value.retention, ["active-only", "warm", "pinned"], "activity tab retention"),
	};
}

export function parseQuickJsWorkerMessage(value: unknown): QuickJsWorkerOutboundMessage {
	if (!isRecord(value) || typeof value.type !== "string") throw new Error("Invalid QuickJS worker message");
	switch (value.type) {
		case "ready":
			return { type: "ready" };
		case "disposed":
			return { type: "disposed" };
		case "registerActivityTab":
			return { type: "registerActivityTab", contribution: parseActivityTab(value.contribution) };
		case "updateActivityTab":
			return {
				type: "updateActivityTab",
				tabId: requiredString(value.tabId, "activity tab id", 64),
				view: parseQuickJsDeclarativeNode(value.view),
			};
		case "openActivityTab": {
			const width = value.width;
			if (width !== undefined && width !== "max" && (typeof width !== "number" || !Number.isFinite(width))) {
				throw new Error("Invalid QuickJS activity tab width");
			}
			return { type: "openActivityTab", tabId: requiredString(value.tabId, "activity tab id", 64), width };
		}
		case "setActivityTabVisible":
			if (typeof value.visible !== "boolean") throw new Error("Invalid QuickJS activity tab visibility");
			return {
				type: "setActivityTabVisible",
				tabId: requiredString(value.tabId, "activity tab id", 64),
				visible: value.visible,
			};
		case "notify": {
			if (!isRecord(value.options)) throw new Error("Invalid QuickJS notification");
			const variant = assertAllowed(
				value.options.variant,
				["info", "success", "warning", "error"],
				"notification variant",
			);
			const durationMs = value.options.durationMs;
			if (durationMs !== undefined && (typeof durationMs !== "number" || durationMs < 0 || durationMs > 60_000)) {
				throw new Error("Invalid QuickJS notification duration");
			}
			return {
				type: "notify",
				options: {
					message: requiredString(value.options.message, "notification message"),
					title: optionalString(value.options.title, "notification title", 256),
					variant,
					durationMs,
				},
			};
		}
		case "hostCall": {
			if (
				!Number.isSafeInteger(value.callId) ||
				typeof value.method !== "string" ||
				!HOST_METHODS.has(value.method as QuickJsHostMethod) ||
				!Array.isArray(value.args)
			) {
				throw new Error("Invalid QuickJS host call");
			}
			return {
				type: "hostCall",
				callId: value.callId as number,
				method: value.method as QuickJsHostMethod,
				args: value.args,
			};
		}
		case "error":
			return { type: "error", message: requiredString(value.message, "error message", 16_384) };
		default:
			throw new Error("Invalid QuickJS worker message type");
	}
}
