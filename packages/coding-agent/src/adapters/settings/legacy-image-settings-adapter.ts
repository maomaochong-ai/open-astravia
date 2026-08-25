import {
	RuntimeConfigurationCenter,
	type RuntimeConfigurationJsonObject,
	type RuntimeConfigurationSnapshotAcquireContext,
	RuntimeConfigurationSnapshotCoordinator,
	type RuntimeConfigurationSnapshotLease,
	type RuntimeConfigurationSnapshotSource,
} from "@vetta/runtime-core/configuration";
import type { RuntimeObservationPublisher } from "@vetta/runtime-core/observation";
import { runtimeObservationFailure } from "@vetta/runtime-core/observation";
import { CODING_IMAGE_CONFIGURATION } from "@vetta/runtime-tools";
import { CODING_AGENT_CONFIGURATION_ISSUE_OBSERVATION } from "../../model-context/image-settings-observations.js";
import type { CodingAgentLegacyImageSettingsSource } from "../../model-context/image-settings-source.js";

const LEGACY_SETTINGS_SOURCE_ID = "coding-agent.legacy-image-settings";
const LEGACY_SETTINGS_LAYER_ID = "legacy-settings.images";

export interface CodingAgentLegacyImageSettingsRuntimeOptions {
	readonly settings?: CodingAgentLegacyImageSettingsSource;
	readonly observationPublisher?: RuntimeObservationPublisher;
}

/** 将旧 Settings 字段隔离为兼容 Layer；新消费者只读取 Runtime Configuration Snapshot。 */
export class CodingAgentLegacyImageSettingsRuntime implements RuntimeConfigurationSnapshotSource {
	private readonly center: RuntimeConfigurationCenter;
	private readonly coordinator: RuntimeConfigurationSnapshotCoordinator;

	constructor(private readonly options: CodingAgentLegacyImageSettingsRuntimeOptions = {}) {
		this.center = new RuntimeConfigurationCenter({ observationPublisher: options.observationPublisher });
		this.center.definitions.upsert({
			source: { id: "coding-agent", revision: "1" },
			definition: CODING_IMAGE_CONFIGURATION,
		});
		this.coordinator = new RuntimeConfigurationSnapshotCoordinator({
			acquire: (context) => {
				this.refreshLegacyLayer();
				return this.center.acquire(context);
			},
		});
	}

	acquire(context?: RuntimeConfigurationSnapshotAcquireContext): RuntimeConfigurationSnapshotLease {
		return this.coordinator.acquire(context);
	}

	close(): Promise<void> {
		return this.center.close();
	}

	private refreshLegacyLayer(): void {
		let patch: RuntimeConfigurationJsonObject;
		try {
			this.options.settings?.reloadImageSettings?.();
			const images = this.options.settings?.getImageSettings?.();
			const autoResize = this.options.settings?.getImageAutoResize?.();
			const blockImages = this.options.settings?.getBlockImages?.();
			patch = {
				...(images ?? {}),
				...(autoResize === undefined ? {} : { autoResize }),
				...(blockImages === undefined ? {} : { blockImages }),
			};
		} catch (error) {
			this.options.observationPublisher?.record(CODING_AGENT_CONFIGURATION_ISSUE_OBSERVATION, {
				operation: "legacy-settings.refresh",
				code: "legacy-settings-read-failed",
				failure: runtimeObservationFailure(error),
			});
			return;
		}
		const revision = createLegacySettingsRevision(patch);
		this.center.layers.replaceSource(
			{ id: LEGACY_SETTINGS_SOURCE_ID, revision },
			Object.keys(patch).length === 0
				? []
				: [
						{
							id: LEGACY_SETTINGS_LAYER_ID,
							revision,
							precedence: 100,
							values: { [CODING_IMAGE_CONFIGURATION.id]: patch },
						},
					],
		);
	}
}

function createLegacySettingsRevision(value: RuntimeConfigurationJsonObject): string {
	return `images:${JSON.stringify(value)}`;
}
