import type { PluginCodingAgentHookEventName } from "@vetta-org/plugin-sdk";

export interface DesktopPluginHookRegistration {
	readonly id: string;
	readonly eventName: PluginCodingAgentHookEventName;
	readonly handlerId: string;
	readonly activationId?: string;
	readonly timeoutMs?: number;
	readonly scope_use: readonly string[];
	readonly agent_mode?: readonly string[];
	readonly toolNames?: readonly string[];
}

export interface DesktopPluginHookBinding extends DesktopPluginHookRegistration {
	readonly pluginId: string;
	readonly order: number;
}

/** Process-local source of dynamically registered Desktop Plugin Hook callbacks. */
export class DesktopPluginHookRegistry {
	private readonly plugins = new Map<string, Map<string, DesktopPluginHookRegistration>>();

	register(pluginId: string, registration: DesktopPluginHookRegistration): void {
		let registrations = this.plugins.get(pluginId);
		if (!registrations) {
			registrations = new Map();
			this.plugins.set(pluginId, registrations);
		}
		registrations.set(registration.id, registration);
	}

	unregister(pluginId: string, hookId: string, activationId?: string): boolean {
		const registrations = this.plugins.get(pluginId);
		const current = registrations?.get(hookId);
		if (!registrations || !current) return false;
		if (activationId !== undefined && current.activationId !== activationId) return false;
		registrations.delete(hookId);
		if (registrations.size === 0) this.plugins.delete(pluginId);
		return true;
	}

	clear(pluginId: string): number {
		const count = this.plugins.get(pluginId)?.size ?? 0;
		this.plugins.delete(pluginId);
		return count;
	}

	count(pluginId: string): number {
		return this.plugins.get(pluginId)?.size ?? 0;
	}

	hasEvent(eventName: PluginCodingAgentHookEventName): boolean {
		for (const registrations of this.plugins.values()) {
			for (const registration of registrations.values()) {
				if (registration.eventName === eventName) return true;
			}
		}
		return false;
	}

	snapshot(): readonly DesktopPluginHookBinding[] {
		let order = 0;
		return [...this.plugins].flatMap(([pluginId, registrations]) =>
			[...registrations.values()].map((registration) => ({
				...registration,
				pluginId,
				order: order++,
			})),
		);
	}
}

export const desktopPluginHookRegistry = new DesktopPluginHookRegistry();
