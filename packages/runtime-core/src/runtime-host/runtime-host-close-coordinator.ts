import {
	type RuntimeObservationPort,
	type RuntimeObservationPublisher,
	runtimeObservationFailure,
} from "../observation/index.js";
import { RUNTIME_HOST_LIFECYCLE_OBSERVATION } from "./observations.js";
import { RetryableCloseController } from "./retryable-cleanup.js";

export type RuntimeHostCloseComponent =
	| "session-creations"
	| "sessions"
	| "agent-backends"
	| "session-backend"
	| "agent-runtime";

export interface RuntimeHostCloseCoordinatorOptions {
	readonly observations: RuntimeObservationPublisher;
	readonly ownsObservationPublisher: boolean;
	readonly ownedObservationPort?: RuntimeObservationPort;
	readonly tasks: ReadonlyArray<{
		readonly component: RuntimeHostCloseComponent;
		readonly dispose: () => Promise<void>;
	}>;
}

/** Retryable ordered close plan for every resource directly owned by RuntimeHost. */
export class RuntimeHostCloseCoordinator {
	private readonly controller: RetryableCloseController;
	private taskIndex = 0;
	private completedRecorded = false;

	constructor(private readonly options: RuntimeHostCloseCoordinatorOptions) {
		this.controller = new RetryableCloseController({ cleanup: () => this.closeOwnedResources() });
	}

	close(): Promise<void> {
		return this.controller.run();
	}

	private async closeOwnedResources(): Promise<void> {
		this.options.observations.record(RUNTIME_HOST_LIFECYCLE_OBSERVATION, {
			operation: "host.close",
			phase: "started",
		});
		while (this.taskIndex < this.options.tasks.length) {
			const task = this.options.tasks[this.taskIndex];
			if (!task) break;
			try {
				await task.dispose();
			} catch (error) {
				this.options.observations.record(RUNTIME_HOST_LIFECYCLE_OBSERVATION, {
					operation: "host.close",
					phase: "failed",
					component: task.component,
					failure: runtimeObservationFailure(error),
				});
				throw new AggregateError([error], "Failed to close RuntimeHost resources", { cause: error });
			}
			this.taskIndex += 1;
		}
		if (!this.completedRecorded) {
			this.completedRecorded = true;
			this.options.observations.record(RUNTIME_HOST_LIFECYCLE_OBSERVATION, {
				operation: "host.close",
				phase: "completed",
			});
		}
		if (this.options.ownsObservationPublisher) {
			try {
				await this.options.observations.flush();
			} catch (error) {
				this.options.observations.record(RUNTIME_HOST_LIFECYCLE_OBSERVATION, {
					operation: "host.close",
					phase: "failed",
					component: "observation-publisher",
					failure: runtimeObservationFailure(error),
				});
				throw error;
			}
		}
		if (this.options.ownedObservationPort?.close) {
			try {
				await this.options.ownedObservationPort.close();
			} catch (error) {
				this.options.observations.record(RUNTIME_HOST_LIFECYCLE_OBSERVATION, {
					operation: "host.close",
					phase: "failed",
					component: "observation-port",
					failure: runtimeObservationFailure(error),
				});
				throw error;
			}
		}
	}
}
