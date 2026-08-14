import type { PluginCodingAgentHookEventName } from "@vetta-org/plugin-sdk";

export interface DesktopPluginHookRegistration {
	readonly id: string;
	readonly eventName: PluginCodingAgentHookEventName;
	readonly handlerId: string;
	readonly activationId?: string;
	readonly timeoutMs?: number;
	readonly scope_use: readonly string[];
	/** 插件声明的偏好模式，仅作元数据保留：不再用于过滤 hook 触发。 */
	readonly toolNames?: readonly string[];
}

export interface DesktopPluginHookBinding extends DesktopPluginHookRegistration {
	readonly pluginId: string;
	readonly order: number;
}

export interface DesktopPluginHookSnapshotLease {
	readonly bindings: readonly DesktopPluginHookBinding[];
	release(): void;
}

export interface DesktopPluginHookReleasedHandler {
	readonly pluginId: string;
	readonly handlerId: string;
	readonly activationId?: string;
}

interface HookGeneration {
	readonly pluginId: string;
	readonly registration: DesktopPluginHookRegistration;
	activeLeases: number;
	retired: boolean;
	released: boolean;
	revokedReason?: string;
}

/**
 * Process-local Hook generation owner.
 *
 * register/unregister/clear 只改变后续 snapshot 的 membership；活动 Turn 通过
 * acquireSnapshot() 持有旧 handler generation，最后一个 lease 释放后才通知 renderer 删除实体。
 */
export class DesktopPluginHookRegistry {
	private readonly plugins = new Map<string, Map<string, HookGeneration>>();
	private readonly retired = new Set<HookGeneration>();
	private readonly releaseListeners = new Set<(handler: DesktopPluginHookReleasedHandler) => void>();

	register(pluginId: string, registration: DesktopPluginHookRegistration): void {
		let registrations = this.plugins.get(pluginId);
		if (!registrations) {
			registrations = new Map();
			this.plugins.set(pluginId, registrations);
		}
		const previous = registrations.get(registration.id);
		registrations.set(registration.id, createGeneration(pluginId, registration));
		if (previous) this.retire(previous);
	}

	unregister(pluginId: string, hookId: string, activationId?: string): boolean {
		const registrations = this.plugins.get(pluginId);
		const current = registrations?.get(hookId);
		if (!registrations || !current) return false;
		if (activationId !== undefined && current.registration.activationId !== activationId) return false;
		registrations.delete(hookId);
		if (registrations.size === 0) this.plugins.delete(pluginId);
		this.retire(current);
		return true;
	}

	clear(pluginId: string): number {
		const registrations = this.plugins.get(pluginId);
		if (!registrations) return 0;
		this.plugins.delete(pluginId);
		for (const generation of registrations.values()) this.retire(generation);
		return registrations.size;
	}

	count(pluginId: string): number {
		return this.plugins.get(pluginId)?.size ?? 0;
	}

	hasEvent(eventName: PluginCodingAgentHookEventName): boolean {
		for (const registrations of this.plugins.values()) {
			for (const generation of registrations.values()) {
				if (generation.registration.eventName === eventName) return true;
			}
		}
		return false;
	}

	snapshot(): readonly DesktopPluginHookBinding[] {
		return this.readCurrentGenerations().map((generation, order) => toBinding(generation, order));
	}

	acquireSnapshot(
		predicate: (binding: DesktopPluginHookBinding) => boolean = () => true,
	): DesktopPluginHookSnapshotLease {
		const selected = this.readCurrentGenerations()
			.map((generation, order) => ({ generation, order }))
			.filter(({ generation, order }) => predicate(toBinding(generation, order)));
		for (const { generation } of selected) generation.activeLeases += 1;
		const bindings = Object.freeze(selected.map(({ generation, order }) => toBinding(generation, order)));
		let released = false;
		return {
			bindings,
			release: () => {
				if (released) return;
				released = true;
				for (const { generation } of selected) {
					generation.activeLeases -= 1;
					this.releaseIfUnused(generation);
				}
			},
		};
	}

	/** Security boundary: unlike ordinary retirement, this invalidates already-admitted Turn leases. */
	hardRevoke(pluginId: string, reason: string): number {
		let revoked = 0;
		for (const generation of [...this.readCurrentGenerations(), ...this.retired]) {
			if (generation.pluginId !== pluginId || generation.revokedReason !== undefined) continue;
			generation.revokedReason = reason;
			revoked += 1;
		}
		return revoked;
	}

	readInvocationRejection(pluginId: string, handlerId: string, activationId?: string): string | undefined {
		const generation = [...this.readCurrentGenerations(), ...this.retired].find(
			(candidate) =>
				candidate.pluginId === pluginId &&
				candidate.registration.handlerId === handlerId &&
				candidate.registration.activationId === activationId &&
				candidate.activeLeases > 0,
		);
		if (!generation) return "Hook handler does not belong to an active Turn lease";
		return generation.revokedReason;
	}

	onHandlerReleased(listener: (handler: DesktopPluginHookReleasedHandler) => void): () => void {
		this.releaseListeners.add(listener);
		return () => this.releaseListeners.delete(listener);
	}

	releaseUnpublished(handler: DesktopPluginHookReleasedHandler): void {
		this.notifyReleased(handler);
	}

	readLeaseDiagnostics(): { readonly retiredGenerations: number; readonly activeLeases: number } {
		const all = [...this.readCurrentGenerations(), ...this.retired];
		return {
			retiredGenerations: this.retired.size,
			activeLeases: all.reduce((total, generation) => total + generation.activeLeases, 0),
		};
	}

	private readCurrentGenerations(): HookGeneration[] {
		return [...this.plugins.values()].flatMap((registrations) => [...registrations.values()]);
	}

	private retire(generation: HookGeneration): void {
		if (generation.retired) return;
		generation.retired = true;
		this.retired.add(generation);
		this.releaseIfUnused(generation);
	}

	private releaseIfUnused(generation: HookGeneration): void {
		if (!generation.retired || generation.released || generation.activeLeases > 0) return;
		generation.released = true;
		this.retired.delete(generation);
		const released = {
			pluginId: generation.pluginId,
			handlerId: generation.registration.handlerId,
			activationId: generation.registration.activationId,
		};
		this.notifyReleased(released);
	}

	private notifyReleased(released: DesktopPluginHookReleasedHandler): void {
		for (const listener of this.releaseListeners) {
			try {
				listener(released);
			} catch {
				// Resource cleanup notifications must not corrupt registry retirement.
			}
		}
	}
}

function createGeneration(pluginId: string, registration: DesktopPluginHookRegistration): HookGeneration {
	return {
		pluginId,
		registration: Object.freeze({
			...registration,
			scope_use: Object.freeze([...registration.scope_use]),
			toolNames: registration.toolNames ? Object.freeze([...registration.toolNames]) : undefined,
		}),
		activeLeases: 0,
		retired: false,
		released: false,
		revokedReason: undefined,
	};
}

function toBinding(generation: HookGeneration, order: number): DesktopPluginHookBinding {
	return Object.freeze({ ...generation.registration, pluginId: generation.pluginId, order });
}

export const desktopPluginHookRegistry = new DesktopPluginHookRegistry();
