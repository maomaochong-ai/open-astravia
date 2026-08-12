import { describe, expect, it } from "vitest";
import {
	AtomicRuntimeSnapshotProvider,
	type CompiledRuntimeSnapshot,
	KERNEL_ERROR_CODES,
	PassthroughContextStrategy,
	type RuntimeSnapshot,
} from "../../src/kernel/index.js";

function compiledSnapshot(id: string, disposed: string[]): CompiledRuntimeSnapshot {
	const snapshot: RuntimeSnapshot = {
		id,
		instructions: [],
		tools: new Map(),
		contextProviders: [],
		contextStrategy: new PassthroughContextStrategy(),
		toolPolicy: {
			async authorize() {
				return true;
			},
		},
		tokenBudget: 8_000,
		reservedOutputTokens: 1_000,
		observers: [],
	};
	let isDisposed = false;
	return {
		snapshot,
		async dispose() {
			if (isDisposed) return;
			isDisposed = true;
			disposed.push(id);
		},
	};
}

describe("AtomicRuntimeSnapshotProvider", () => {
	it("starts model and snapshot capture before either asynchronous binder can yield", async () => {
		const disposed: string[] = [];
		let revision = "r1";
		let releaseModelBinding: () => void = () => {};
		const modelBindingBarrier = new Promise<void>((resolve) => {
			releaseModelBinding = resolve;
		});
		let modelCapture: string | undefined;
		let providerCapture: string | undefined;
		const compiled = compiledSnapshot("snapshot-1", disposed);
		const provider = new AtomicRuntimeSnapshotProvider(
			{
				...compiled,
				snapshot: {
					...compiled.snapshot,
					modelCallProviders: [
						{
							id: "capture",
							bindForTurn() {
								providerCapture = revision;
								return this;
							},
							contribute: async () => ({}),
						},
					],
				},
			},
			{
				async bind() {
					modelCapture = revision;
					await modelBindingBarrier;
					return { model: {} as never };
				},
			},
		);
		const acquisition = provider.acquire(turnContext("turn-1"));
		revision = "r2";
		releaseModelBinding();
		const lease = await acquisition;

		expect(modelCapture).toBe("r1");
		expect(providerCapture).toBe("r1");
		await lease.release();
		await provider.close();
	});

	it("binds dynamic components once for the admitted Turn", async () => {
		const disposed: string[] = [];
		let value = "r1";
		let bindCount = 0;
		let releaseCount = 0;
		const compiled = compiledSnapshot("snapshot-1", disposed);
		const provider = new AtomicRuntimeSnapshotProvider({
			...compiled,
			snapshot: {
				...compiled.snapshot,
				modelCallProviders: [
					{
						id: "dynamic",
						bindForTurn() {
							bindCount += 1;
							const captured = value;
							return {
								id: "dynamic",
								releaseTurnBinding() {
									releaseCount += 1;
								},
								async contribute() {
									return { instructions: [{ id: captured, content: captured, priority: 0 }] };
								},
							};
						},
						async contribute() {
							return {};
						},
					},
				],
			},
		});
		const lease = await provider.acquire(turnContext("turn-1"));
		value = "r2";
		const boundProvider = lease.snapshot.modelCallProviders?.[0];

		expect((await boundProvider?.contribute(modelCallContext("turn-1")))?.instructions?.[0]?.id).toBe("r1");
		expect((await boundProvider?.contribute(modelCallContext("turn-1")))?.instructions?.[0]?.id).toBe("r1");
		expect(bindCount).toBe(1);

		await lease.release();
		await lease.release();
		expect(releaseCount).toBe(1);
		await provider.close();
	});

	it("binds and releases continuation and finalization policies with the same Turn lease", async () => {
		const disposed: string[] = [];
		const released: string[] = [];
		const compiled = compiledSnapshot("snapshot-1", disposed);
		const provider = new AtomicRuntimeSnapshotProvider({
			...compiled,
			snapshot: {
				...compiled.snapshot,
				continuationPolicy: {
					bindForTurn: () => ({
						releaseTurnBinding: () => {
							released.push("continuation");
						},
						collect: async () => [],
					}),
					collect: async () => [],
				},
				modelCallMessageFinalizer: {
					bindForTurn: () => ({
						releaseTurnBinding: () => {
							released.push("finalizer");
						},
						finalize: async ({ messages }) => messages,
					}),
					finalize: async ({ messages }) => messages,
				},
			},
		});

		const lease = await provider.acquire(turnContext("turn-1"));
		expect(lease.snapshot.continuationPolicy).not.toBe(compiled.snapshot.continuationPolicy);
		expect(lease.snapshot.modelCallMessageFinalizer).not.toBe(compiled.snapshot.modelCallMessageFinalizer);

		await lease.release();
		await lease.release();
		expect(released).toEqual(["continuation", "finalizer"]);
		await provider.close();
	});

	it("releases the selected generation when Turn binding fails", async () => {
		const disposed: string[] = [];
		let turnBindingReleases = 0;
		const compiled = compiledSnapshot("snapshot-1", disposed);
		const provider = new AtomicRuntimeSnapshotProvider({
			...compiled,
			snapshot: {
				...compiled.snapshot,
				modelCallProviders: [
					{
						id: "successful",
						bindForTurn() {
							return {
								id: "successful",
								releaseTurnBinding() {
									turnBindingReleases += 1;
								},
								async contribute() {
									return {};
								},
							};
						},
						async contribute() {
							return {};
						},
					},
					{
						id: "failing",
						bindForTurn() {
							throw new Error("capture failed");
						},
						async contribute() {
							return {};
						},
					},
				],
			},
		});

		await expect(provider.acquire(turnContext("turn-1"))).rejects.toThrow("capture failed");
		await provider.swap(compiledSnapshot("snapshot-2", disposed));

		expect(disposed).toEqual(["snapshot-1"]);
		expect(turnBindingReleases).toBe(1);
		await provider.close();
	});

	it("keeps a retired snapshot alive until its active turn releases it", async () => {
		const disposed: string[] = [];
		const provider = new AtomicRuntimeSnapshotProvider(compiledSnapshot("snapshot-1", disposed));
		const firstLease = await provider.acquire();

		await provider.swap(compiledSnapshot("snapshot-2", disposed));
		expect(disposed).toEqual([]);

		const secondLease = await provider.acquire();
		expect(firstLease.snapshot.id).toBe("snapshot-1");
		expect(secondLease.snapshot.id).toBe("snapshot-2");

		await firstLease.release();
		expect(disposed).toEqual(["snapshot-1"]);

		await secondLease.release();
		expect(disposed).toEqual(["snapshot-1"]);
		await provider.close();
		expect(disposed).toEqual(["snapshot-1", "snapshot-2"]);
	});

	it("waits for active leases before close disposes the current snapshot", async () => {
		const disposed: string[] = [];
		const provider = new AtomicRuntimeSnapshotProvider(compiledSnapshot("snapshot-1", disposed));
		const lease = await provider.acquire();
		let closeCompleted = false;
		let secondCloseCompleted = false;
		const close = provider.close().then(() => {
			closeCompleted = true;
		});
		const secondClose = provider.close().then(() => {
			secondCloseCompleted = true;
		});

		await Promise.resolve();
		expect(closeCompleted).toBe(false);
		expect(secondCloseCompleted).toBe(false);
		expect(disposed).toEqual([]);

		await lease.release();
		await Promise.all([close, secondClose]);
		expect(closeCompleted).toBe(true);
		expect(secondCloseCompleted).toBe(true);
		expect(disposed).toEqual(["snapshot-1"]);
	});

	it("makes lease release idempotent", async () => {
		const disposed: string[] = [];
		const provider = new AtomicRuntimeSnapshotProvider(compiledSnapshot("snapshot-1", disposed));
		const lease = await provider.acquire();

		await provider.swap(compiledSnapshot("snapshot-2", disposed));
		await lease.release();
		await lease.release();

		expect(disposed).toEqual(["snapshot-1"]);
		await provider.close();
	});

	it("rejects acquire after close", async () => {
		const disposed: string[] = [];
		const provider = new AtomicRuntimeSnapshotProvider(compiledSnapshot("snapshot-1", disposed));
		await provider.close();

		await expect(provider.acquire()).rejects.toMatchObject({
			code: KERNEL_ERROR_CODES.SNAPSHOT_PROVIDER_CLOSED,
		});
	});

	it("disposes a rejected swap after close", async () => {
		const disposed: string[] = [];
		const provider = new AtomicRuntimeSnapshotProvider(compiledSnapshot("snapshot-1", disposed));
		await provider.close();

		await expect(provider.swap(compiledSnapshot("snapshot-2", disposed))).rejects.toMatchObject({
			code: KERNEL_ERROR_CODES.SNAPSHOT_PROVIDER_CLOSED,
		});
		expect(disposed).toEqual(["snapshot-1", "snapshot-2"]);
	});
});

function turnContext(operationId: string) {
	return {
		sessionId: "session-1",
		operationId,
		reason: "turn" as const,
		signal: new AbortController().signal,
	};
}

function modelCallContext(turnId: string) {
	return {
		sessionId: "session-1",
		turnId,
		signal: new AbortController().signal,
	};
}
