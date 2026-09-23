import { capturePromptResourceSource, snapshotPromptResourceSource } from "../../model-context/prompt-snapshot.js";
import type { CodingAgentPromptResourceSource } from "../../runtime-contracts/index.js";

/** Session admission owns refresh; all binders consume the same materialized resources. */
export class AdmittedPromptResources {
	readonly source: CodingAgentPromptResourceSource;
	private current: CodingAgentPromptResourceSource;

	constructor(private readonly raw: CodingAgentPromptResourceSource) {
		// Assembly reads the already loaded catalog before the first admission.
		this.current = snapshotPromptResourceSource(raw);
		this.source = {
			getAgentsFiles: () => this.current.getAgentsFiles(),
			getAppendSystemPrompt: () => this.current.getAppendSystemPrompt(),
			getSkills: () => this.current.getSkills(),
			getSystemPrompt: () => this.current.getSystemPrompt(),
			refreshSkillsIfChanged: async (signal) => {
				signal?.throwIfAborted();
				return false;
			},
			refreshContextResourcesIfChanged: async (signal) => {
				signal?.throwIfAborted();
				return false;
			},
			setRuntimeSkillPaths: async (paths, signal) => {
				await raw.setRuntimeSkillPaths(paths, signal);
				signal?.throwIfAborted();
				// Explicit plugin reconfiguration also updates the unbound tool catalog.
				// The loader has already validated these paths; bound Turns keep their copy.
				this.current = snapshotPromptResourceSource(raw);
			},
		};
	}

	async refresh(signal?: AbortSignal): Promise<void> {
		const next = await capturePromptResourceSource(this.raw, signal);
		signal?.throwIfAborted();
		// Publish only after the entire refresh succeeds. Existing bound consumers
		// retain their copies even when the next admission publishes new resources.
		this.current = next;
	}
}
