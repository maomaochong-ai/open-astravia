import type {
	QuickPanelPostSendBehavior,
	QuickPanelSettings,
	QuickPanelTrigger,
	ShortcutBindingResetResult,
	ShortcutBindingsResult,
	ShortcutSettings,
} from "@vetta/capability-sdk";
import { BrowserWindow } from "electron";
import {
	findShortcutBindingConflict,
	getShortcutActionDef,
	isShortcutActionId,
	isValidShortcutCombo,
	listShortcutBindingsSnapshot,
	normalizeShortcutBindings,
	normalizeShortcutCombo,
	type ShortcutBindings,
} from "../../shared/shortcuts.js";
import { SHORTCUTS_CHANNELS } from "../../shared/shortcuts-ipc.js";
import {
	type DesktopConfig,
	normalizeQuickPanel,
	readDesktopConfig,
	writeDesktopConfig,
} from "../config/desktop-config-store.js";
import { applyQuickPanelTrigger, setQuickPanelTriggerHandler } from "../quickpanel-trigger.js";
import { toggleQuickPanelWindow } from "../quickpanel-window.js";

export interface ShortcutServiceOptions {
	readonly readConfig: () => Promise<DesktopConfig>;
	readonly writeConfig: (config: DesktopConfig) => Promise<void>;
	readonly broadcastBindings: (bindings: Record<string, string>) => void;
	readonly reloadQuickPanelTrigger: () => Promise<void>;
}

function snapshotQuickPanel(config: DesktopConfig): QuickPanelSettings {
	const quickPanel = normalizeQuickPanel(config.quickPanel);
	return {
		trigger: quickPanel.trigger ?? "none",
		postSendBehavior: quickPanel.postSendBehavior ?? "foreground",
	};
}

function readBindings(config: DesktopConfig): ShortcutBindings {
	return normalizeShortcutBindings(config.shortcuts?.bindings);
}

export class ShortcutService {
	constructor(private readonly options: ShortcutServiceOptions) {}

	async getSettings(): Promise<ShortcutSettings> {
		const config = await this.options.readConfig();
		return {
			bindings: listShortcutBindingsSnapshot(readBindings(config)),
			quickPanel: snapshotQuickPanel(config),
		};
	}

	async getQuickPanelSettings(): Promise<QuickPanelSettings> {
		return snapshotQuickPanel(await this.options.readConfig());
	}

	async setBinding(id: string, shortcut: string): Promise<ShortcutBindingsResult> {
		if (!isShortcutActionId(id)) throw new Error(`Unknown shortcut action id: ${id}`);
		const normalized = normalizeShortcutCombo(shortcut);
		if (!isValidShortcutCombo(normalized)) throw new Error(`Invalid shortcut combo: ${shortcut}`);

		const config = await this.options.readConfig();
		const current = readBindings(config);
		const conflict = findShortcutBindingConflict(id, normalized, current);
		if (conflict) {
			throw new Error(`Shortcut ${JSON.stringify(normalized)} is already bound to ${JSON.stringify(conflict)}.`);
		}

		const next: ShortcutBindings = { ...current };
		const definition = getShortcutActionDef(id);
		if (normalized === definition.defaultShortcut) delete next[id];
		else next[id] = normalized;
		await this.persistBindings(config, next);
		return { bindings: listShortcutBindingsSnapshot(next) };
	}

	async resetBinding(id: string): Promise<ShortcutBindingResetResult> {
		if (!isShortcutActionId(id)) throw new Error(`Unknown shortcut action id: ${id}`);
		const config = await this.options.readConfig();
		const next = { ...readBindings(config) };
		delete next[id];
		await this.persistBindings(config, next);
		return {
			bindings: listShortcutBindingsSnapshot(next),
			shortcut: getShortcutActionDef(id).defaultShortcut,
		};
	}

	async resetAllBindings(): Promise<ShortcutBindingsResult> {
		const config = await this.options.readConfig();
		await this.persistBindings(config, {});
		return { bindings: listShortcutBindingsSnapshot({}) };
	}

	async setQuickPanelTrigger(trigger: QuickPanelTrigger): Promise<QuickPanelSettings> {
		const config = await this.options.readConfig();
		const current = snapshotQuickPanel(config);
		await this.options.writeConfig({
			...config,
			quickPanel: { trigger, postSendBehavior: current.postSendBehavior },
		});
		await this.options.reloadQuickPanelTrigger();
		return this.getQuickPanelSettings();
	}

	async setQuickPanelPostSendBehavior(behavior: QuickPanelPostSendBehavior): Promise<QuickPanelSettings> {
		const config = await this.options.readConfig();
		const current = snapshotQuickPanel(config);
		await this.options.writeConfig({
			...config,
			quickPanel: { trigger: current.trigger, postSendBehavior: behavior },
		});
		await this.options.reloadQuickPanelTrigger();
		return this.getQuickPanelSettings();
	}

	notifyBindingsChanged(bindings: Record<string, string>): void {
		this.options.broadcastBindings(bindings);
	}

	private async persistBindings(config: DesktopConfig, bindings: ShortcutBindings): Promise<void> {
		await this.options.writeConfig({ ...config, shortcuts: { bindings } });
		this.options.broadcastBindings(bindings);
	}
}

let triggerHandlerBound = false;

function ensureQuickPanelTriggerHandler(): void {
	if (triggerHandlerBound) return;
	setQuickPanelTriggerHandler(() => toggleQuickPanelWindow());
	triggerHandlerBound = true;
}

export async function syncQuickPanelTrigger(): Promise<void> {
	ensureQuickPanelTriggerHandler();
	const config = await readDesktopConfig();
	applyQuickPanelTrigger(snapshotQuickPanel(config).trigger);
}

function broadcastBindings(bindings: Record<string, string>): void {
	const payload = { bindings };
	for (const win of BrowserWindow.getAllWindows()) {
		if (win.isDestroyed()) continue;
		win.webContents.send(SHORTCUTS_CHANNELS.CHANGED, payload);
	}
}

const desktopShortcutService = new ShortcutService({
	readConfig: readDesktopConfig,
	writeConfig: writeDesktopConfig,
	broadcastBindings,
	reloadQuickPanelTrigger: syncQuickPanelTrigger,
});

export function getDesktopShortcutService(): ShortcutService {
	return desktopShortcutService;
}
