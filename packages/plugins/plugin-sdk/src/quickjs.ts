import type { ConversationScenario } from "./scenario.js";
import type { PluginNetworkRequest, PluginNetworkResponse } from "./network.js";
import type { PluginPutBlobInput, PluginStoredBlob, PluginStoredBlobRef } from "./storage.js";
import type { PluginActivityTabRetention } from "./ui.js";

export type PluginDeclarativeTextTone = "default" | "muted" | "success" | "warning" | "danger";

export interface PluginDeclarativeStack {
	type: "stack";
	direction?: "vertical" | "horizontal";
	gap?: "small" | "medium" | "large";
	children: PluginDeclarativeNode[];
}

export interface PluginDeclarativeSection {
	type: "section";
	title?: string;
	description?: string;
	children: PluginDeclarativeNode[];
}

export interface PluginDeclarativeText {
	type: "text";
	text: string;
	style?: "body" | "heading" | "caption" | "code";
	tone?: PluginDeclarativeTextTone;
}

export interface PluginDeclarativeButton {
	type: "button";
	label: string;
	action: string;
	variant?: "primary" | "secondary" | "outline" | "destructive";
	disabled?: boolean;
}

export interface PluginDeclarativeInput {
	type: "input";
	action: string;
	label?: string;
	value?: string;
	placeholder?: string;
	inputType?: "text" | "password" | "number";
	disabled?: boolean;
}

export interface PluginDeclarativeTextarea {
	type: "textarea";
	action: string;
	label?: string;
	value?: string;
	placeholder?: string;
	disabled?: boolean;
}

export interface PluginDeclarativeSelectOption {
	value: string;
	label: string;
}

export interface PluginDeclarativeSelect {
	type: "select";
	action: string;
	label?: string;
	value?: string;
	placeholder?: string;
	options: PluginDeclarativeSelectOption[];
	disabled?: boolean;
}

export interface PluginDeclarativeSwitch {
	type: "switch";
	action: string;
	label: string;
	checked?: boolean;
	disabled?: boolean;
}

export interface PluginDeclarativeDivider {
	type: "divider";
}

/** Serializable UI rendered exclusively with host-owned components. */
export type PluginDeclarativeNode =
	| PluginDeclarativeStack
	| PluginDeclarativeSection
	| PluginDeclarativeText
	| PluginDeclarativeButton
	| PluginDeclarativeInput
	| PluginDeclarativeTextarea
	| PluginDeclarativeSelect
	| PluginDeclarativeSwitch
	| PluginDeclarativeDivider;

export interface PluginQuickJsActivityTab {
	id: string;
	label: string;
	view: PluginDeclarativeNode;
	scope_use?: readonly ConversationScenario[];
	initiallyVisible?: boolean;
	/** Defaults to `"warm"`; see PluginActivityTabContribution. */
	retention?: PluginActivityTabRetention;
}

export interface PluginDeclarativeActionEvent {
	tabId: string;
	action: string;
	kind: "press" | "change";
	value?: string | number | boolean;
}

/**
 * Public contract exposed as the frozen `vetta` global inside a QuickJS plugin.
 * QuickJS entry scripts are classic scripts and must not import host modules.
 */
export interface PluginQuickJsApi {
	activate(handler: (context: PluginQuickJsContext) => void): void;
	deactivate(handler: () => void): void;
}

export interface PluginQuickJsContext {
	plugin: { id: string; version: string; iconUrl?: string };
	permissions: { has(permission: string): boolean };
	ui: {
		registerActivityTab(contribution: PluginQuickJsActivityTab): void;
		updateActivityTab(tabId: string, view: PluginDeclarativeNode): void;
		onAction(action: string, handler: (event: PluginDeclarativeActionEvent) => void | Promise<void>): void;
		openActivityTab(tabId: string, options?: { width?: number | "max" }): void;
		setActivityTabVisible(tabId: string, visible: boolean): void;
		notify(options: {
			message: string;
			title?: string;
			variant?: "info" | "success" | "warning" | "error";
			durationMs?: number;
		}): void;
	};
	network: {
		request<T = unknown>(request: PluginNetworkRequest): Promise<PluginNetworkResponse<T>>;
	};
	storage: {
		readJson<T = unknown>(key: string): Promise<T | null>;
		writeJson(key: string, value: unknown): Promise<void>;
		list(prefix?: string): Promise<string[]>;
		readFile(path: string): Promise<string | null>;
		writeFile(path: string, data: string): Promise<void>;
		putBlob(input: PluginPutBlobInput): Promise<PluginStoredBlobRef>;
		readBlob(id: string): Promise<PluginStoredBlob | null>;
		getBlobRef(id: string): Promise<PluginStoredBlobRef | null>;
	};
	settings: {
		get<T = unknown>(key: string): T | undefined;
		getAll(): Record<string, unknown>;
		onChange(handler: (values: Record<string, unknown>) => void): void;
	};
	i18n: {
		locale: string;
		t(key: string, params?: Record<string, string | number>): Promise<string>;
		onChange(handler: (locale: string) => void): void;
	};
}
