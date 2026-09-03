import { TeamOperationQueue } from "./team-operation-queue.js";

/** A member owns one execution lane, independent of every other member's lane. */
export class TeamMemberScheduler {
	private readonly lanes = new TeamOperationQueue();
	private readonly pendingByTeam = new Map<string, number>();
	private readonly waits = new Map<string, Map<string, number>>();

	hasPending(teamSessionId: string): boolean {
		return (this.pendingByTeam.get(teamSessionId) ?? 0) > 0;
	}

	async whileWaiting<T>(
		teamSessionId: string,
		sourceMemberId: string,
		targetMemberIds: readonly string[],
		run: () => Promise<T>,
	): Promise<T> {
		const source = memberKey(teamSessionId, sourceMemberId);
		const targets = [...new Set(targetMemberIds)].map((memberId) => memberKey(teamSessionId, memberId));
		for (const target of targets) {
			if (target === source || this.reaches(target, source))
				throw new Error("Team task wait would create a circular member wait");
		}
		for (const target of targets) this.addWait(source, target);
		try {
			return await run();
		} finally {
			for (const target of targets) this.removeWait(source, target);
		}
	}

	schedule<T>(input: {
		readonly teamSessionId: string;
		readonly memberId: string;
		/** Only a synchronous caller holds a wait edge; asynchronous dispatch does not. */
		readonly waitingMemberId?: string;
		readonly signal?: AbortSignal;
		readonly run: () => Promise<T>;
	}): Promise<T> {
		const target = memberKey(input.teamSessionId, input.memberId);
		const source = input.waitingMemberId ? memberKey(input.teamSessionId, input.waitingMemberId) : undefined;
		if (input.signal?.aborted) return Promise.reject(input.signal.reason);
		if (source && (source === target || this.reaches(target, source))) {
			return Promise.reject(new Error("Team delegation would create a circular member wait"));
		}
		if (source) this.addWait(source, target);
		this.pendingByTeam.set(input.teamSessionId, (this.pendingByTeam.get(input.teamSessionId) ?? 0) + 1);
		return new Promise<T>((resolve, reject) => {
			let finished = false;
			const finish = () => {
				if (finished) return;
				finished = true;
				input.signal?.removeEventListener("abort", cancelQueued);
				if (source) this.removeWait(source, target);
				const count = (this.pendingByTeam.get(input.teamSessionId) ?? 1) - 1;
				if (count === 0) this.pendingByTeam.delete(input.teamSessionId);
				else this.pendingByTeam.set(input.teamSessionId, count);
			};
			const cancelQueued = () => {
				finish();
				reject(input.signal?.reason);
			};
			input.signal?.addEventListener("abort", cancelQueued, { once: true });
			void this.lanes.run(target, async () => {
				if (finished) return;
				// Once admitted, the runtime owns cancellation and must release before the next turn.
				input.signal?.removeEventListener("abort", cancelQueued);
				try {
					resolve(await input.run());
				} catch (error) {
					reject(error);
				} finally {
					finish();
				}
			});
		});
	}

	private addWait(source: string, target: string): void {
		const targets = this.waits.get(source) ?? new Map<string, number>();
		targets.set(target, (targets.get(target) ?? 0) + 1);
		this.waits.set(source, targets);
	}

	private removeWait(source: string, target: string): void {
		const targets = this.waits.get(source);
		if (!targets) return;
		const count = (targets.get(target) ?? 1) - 1;
		if (count === 0) targets.delete(target);
		else targets.set(target, count);
		if (targets.size === 0) this.waits.delete(source);
	}

	private reaches(from: string, to: string, visited = new Set<string>()): boolean {
		if (from === to) return true;
		if (visited.has(from)) return false;
		visited.add(from);
		for (const target of this.waits.get(from)?.keys() ?? []) {
			if (this.reaches(target, to, visited)) return true;
		}
		return false;
	}
}

function memberKey(teamSessionId: string, memberId: string): string {
	return JSON.stringify([teamSessionId, memberId]);
}
