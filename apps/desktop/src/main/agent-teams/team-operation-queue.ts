/** Executes one operation per key at a time; a rejection never poisons the next operation. */
export class TeamOperationQueue {
	private readonly tails = new Map<string, Promise<void>>();

	run<T>(key: string, operation: () => Promise<T>): Promise<T> {
		const previous = this.tails.get(key) ?? Promise.resolve();
		const result = previous.then(operation);
		const tail = result.then(
			() => undefined,
			() => undefined,
		);
		this.tails.set(key, tail);
		void tail.then(() => {
			if (this.tails.get(key) === tail) this.tails.delete(key);
		});
		return result;
	}
}
