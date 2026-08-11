interface DeliveryWaiter {
	readonly target: number;
	readonly resolve: () => void;
	readonly reject: (error: Error) => void;
}

export class AgentEventDeliveryBarrier {
	private emitted = 0;
	private consumed = 0;
	private readonly waiters = new Set<DeliveryWaiter>();

	recordEmission(): void {
		this.emitted += 1;
	}

	recordConsumption(): void {
		this.consumed += 1;
		this.resolveDelivered();
	}

	waitForCurrentDelivery(signal: AbortSignal): Promise<void> {
		const target = this.emitted;
		if (this.consumed >= target) return Promise.resolve();
		if (signal.aborted) return Promise.reject(abortError(signal.reason));

		return new Promise((resolve, reject) => {
			const waiter: DeliveryWaiter = {
				target,
				resolve: () => {
					signal.removeEventListener("abort", onAbort);
					this.waiters.delete(waiter);
					resolve();
				},
				reject: (error) => {
					signal.removeEventListener("abort", onAbort);
					this.waiters.delete(waiter);
					reject(error);
				},
			};
			const onAbort = () => waiter.reject(abortError(signal.reason));
			this.waiters.add(waiter);
			signal.addEventListener("abort", onAbort, { once: true });
			this.resolveDelivered();
		});
	}

	private resolveDelivered(): void {
		for (const waiter of [...this.waiters]) {
			if (this.consumed >= waiter.target) waiter.resolve();
		}
	}
}

function abortError(reason: unknown): Error {
	const error = new Error("Agent event delivery aborted", { cause: reason });
	error.name = "AbortError";
	return error;
}
