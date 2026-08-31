import { runtimeObservationFailure } from "@vetta/runtime-core";
import type { AgentSession } from "@vetta/runtime-core/kernel";
import type { RuntimeObservationPublisher } from "@vetta/runtime-core/observation";
import type { CodingAgentSessionConfigurationState } from "../../host/session-configuration/configuration-state.js";
import type { AgentPluginRuntimeConfig } from "../../model-context/plugin-runtime.js";
import { CODING_AGENT_PLUGIN_CONFIGURATION_OBSERVATION } from "../../runtime-contracts/plugin-configuration-observability.js";
import type { CodingAgentPluginRuntimeSource } from "../../runtime-contracts/plugin-runtime.js";

const IDLE_PLUGIN_CONFIGURATION_DELAY_MS = 300;

export interface CodingAgentPluginConfigurationRuntimeOptions {
	readonly configurationState: CodingAgentSessionConfigurationState;
	readonly source?: CodingAgentPluginRuntimeSource;
	readonly apply: (agentPlugins: AgentPluginRuntimeConfig | undefined) => Promise<void>;
	readonly observationPublisher?: RuntimeObservationPublisher;
}

/**
 * Plugin 配置的产品级发布器。
 *
 * 宿主更新只写入 pending；空闲 Session 防抖应用，运行中的 Session 在下一次
 * snapshot acquire 前应用。已取得的 Turn revision 始终保持不变。
 */
export class CodingAgentPluginConfigurationRuntime {
	private session: AgentSession | undefined;
	private pendingBaseRefresh = false;
	private pendingSelectionRefresh = false;
	private pendingOverride: AgentPluginRuntimeConfig | undefined;
	private hasPendingOverride = false;
	private idleTimer: ReturnType<typeof setTimeout> | undefined;
	private applyInFlight: Promise<void> | undefined;
	private disposed = false;
	private readonly unsubscribe: (() => void) | undefined;

	constructor(private readonly options: CodingAgentPluginConfigurationRuntimeOptions) {
		this.unsubscribe = options.source?.subscribe?.(() => this.refreshBase());
	}

	bindSession(session: AgentSession): void {
		if (this.session && this.session !== session) {
			throw new Error("Coding Agent Plugin configuration runtime is already bound");
		}
		this.session = session;
		this.scheduleIdleApply();
	}

	refreshBase(): void {
		this.assertOpen();
		if (this.options.configurationState.hasAgentPluginOverride()) return;
		this.pendingBaseRefresh = true;
		this.scheduleIdleApply();
	}

	refreshSelection(): void {
		this.assertOpen();
		this.pendingSelectionRefresh = true;
	}

	async applyOverride(agentPlugins: AgentPluginRuntimeConfig | undefined): Promise<void> {
		this.assertOpen();
		this.pendingOverride = agentPlugins;
		this.hasPendingOverride = true;
		this.pendingBaseRefresh = false;
		if (this.session?.state === "idle") {
			await this.synchronize("idle-apply");
		}
	}

	async synchronize(phase: "idle-apply" | "turn-apply" = "turn-apply"): Promise<void> {
		this.assertOpen();
		if (this.applyInFlight) await this.applyInFlight;
		if (!this.hasPendingOverride && !this.pendingBaseRefresh && !this.pendingSelectionRefresh) return;

		const hasOverride = this.hasPendingOverride;
		const source = hasOverride ? "session-override" : "host";
		const boundary = phase === "idle-apply" ? "idle" : "turn";
		const startedAt = Date.now();
		this.options.observationPublisher?.record(CODING_AGENT_PLUGIN_CONFIGURATION_OBSERVATION, {
			phase: "started",
			source,
			boundary,
		});
		const agentPlugins = hasOverride ? this.pendingOverride : this.options.configurationState.readRawAgentPlugins();
		this.pendingSelectionRefresh = false;
		this.hasPendingOverride = false;
		this.pendingOverride = undefined;
		this.pendingBaseRefresh = false;
		const apply = this.options.apply(this.options.configurationState.selectAgentPlugins(agentPlugins));
		this.applyInFlight = apply;
		try {
			await apply;
			if (hasOverride) this.options.configurationState.setAgentPluginOverride(agentPlugins);
			else this.options.configurationState.publishBaseAgentPluginRevision();
			this.options.observationPublisher?.record(CODING_AGENT_PLUGIN_CONFIGURATION_OBSERVATION, {
				phase: "completed",
				source,
				boundary,
				durationMs: Math.max(0, Date.now() - startedAt),
			});
		} catch (error) {
			this.pendingSelectionRefresh = true;
			if (hasOverride) {
				if (!this.hasPendingOverride) {
					this.pendingOverride = agentPlugins;
					this.hasPendingOverride = true;
				}
			} else if (!this.hasPendingOverride) {
				this.pendingBaseRefresh = true;
			}
			this.options.observationPublisher?.record(CODING_AGENT_PLUGIN_CONFIGURATION_OBSERVATION, {
				phase: "failed",
				source,
				boundary,
				durationMs: Math.max(0, Date.now() - startedAt),
				failure: runtimeObservationFailure(error),
			});
			throw error;
		} finally {
			this.applyInFlight = undefined;
		}

		if (this.hasPendingOverride || this.pendingBaseRefresh || this.pendingSelectionRefresh)
			await this.synchronize(phase);
	}

	dispose(): void {
		this.disposed = true;
		this.unsubscribe?.();
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = undefined;
		this.session = undefined;
	}

	private scheduleIdleApply(): void {
		if (this.disposed || !this.session || (!this.hasPendingOverride && !this.pendingBaseRefresh)) return;
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = setTimeout(() => {
			this.idleTimer = undefined;
			if (this.disposed || this.session?.state !== "idle") return;
			void this.synchronize("idle-apply").catch(() => {
				// Observation 已记录安全失败；pending 会留到下一次 Turn admission 重试。
			});
		}, IDLE_PLUGIN_CONFIGURATION_DELAY_MS);
	}

	private assertOpen(): void {
		if (this.disposed) throw new Error("Coding Agent Plugin configuration runtime is disposed");
	}
}
