export class CodingToolExecutionTracker {
	private readonly controllersByCapabilityId = new Map<string, Set<AbortController>>();

	async run<TResult>(
		capabilityId: string,
		parentSignal: AbortSignal,
		execute: (signal: AbortSignal) => Promise<TResult>,
		createRevokedError: () => Error,
	): Promise<TResult> {
		const revokeController = new AbortController();
		const signal = AbortSignal.any([parentSignal, revokeController.signal]);
		signal.throwIfAborted();
		const controllers = this.controllersByCapabilityId.get(capabilityId) ?? new Set<AbortController>();
		controllers.add(revokeController);
		this.controllersByCapabilityId.set(capabilityId, controllers);

		try {
			const result = await execute(signal);
			if (revokeController.signal.aborted) {
				throw createRevokedError();
			}
			return result;
		} catch (error) {
			if (revokeController.signal.aborted) {
				throw createRevokedError();
			}
			throw error;
		} finally {
			controllers.delete(revokeController);
			if (controllers.size === 0) {
				this.controllersByCapabilityId.delete(capabilityId);
			}
		}
	}

	revoke(capabilityId: string, reason: string): void {
		for (const controller of this.controllersByCapabilityId.get(capabilityId) ?? []) {
			controller.abort(reason);
		}
	}
}
