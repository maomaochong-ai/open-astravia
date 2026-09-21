import { getAppLogger } from "../logger.js";

const log = getAppLogger("agent-team-recovery");
export const TEAM_RECOVERY_SCAN_INTERVAL_MS = 30_000;

/** Local reconciliation only; a healthy execution never causes a model heartbeat. */
export class TeamRecoveryMonitor {
	private timer: ReturnType<typeof setTimeout> | undefined;
	private running = false;
	private active = false;
	private generation = 0;
	constructor(private readonly reconcile: () => Promise<boolean>) {}

	start(): void {
		this.generation += 1;
		this.active = true;
		if (!this.timer && !this.running) this.schedule();
	}

	stop(): void {
		this.generation += 1;
		this.active = false;
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
	}

	private schedule(): void {
		this.timer = setTimeout(() => {
			void this.scan();
		}, TEAM_RECOVERY_SCAN_INTERVAL_MS);
		this.timer.unref?.();
	}

	private async scan(): Promise<void> {
		this.timer = undefined;
		this.running = true;
		const generation = this.generation;
		try {
			if (!(await this.reconcile()) && generation === this.generation) this.active = false;
		} catch (error) {
			log.warn("Team recovery reconciliation failed", {
				errorName: error instanceof Error ? error.name : "UnknownError",
			});
		} finally {
			this.running = false;
			if (this.active) this.schedule();
		}
	}
}
