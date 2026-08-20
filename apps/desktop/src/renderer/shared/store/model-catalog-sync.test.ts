import { beforeEach, describe, expect, it, vi } from "vitest";
import { createModelCatalogSync, type ModelCatalogSync } from "./model-catalog-sync";

interface Harness {
	sync: ModelCatalogSync;
	setNow: (value: number) => void;
	loadLocal: ReturnType<typeof vi.fn>;
	loadRemote: ReturnType<typeof vi.fn>;
	applyLocal: ReturnType<typeof vi.fn>;
	applyRemote: ReturnType<typeof vi.fn>;
	onError: ReturnType<typeof vi.fn>;
}

function createHarness(): Harness {
	let now = 1_000;
	const loadLocal = vi.fn(async () => ({ providers: {} }));
	const loadRemote = vi.fn(async (): Promise<Record<string, unknown> | null> => ({ "vetta-go": {} }));
	const applyLocal = vi.fn();
	const applyRemote = vi.fn();
	const onError = vi.fn();
	const sync = createModelCatalogSync({
		now: () => now,
		ttlMs: 60_000,
		errorCooldownMs: 10_000,
		loadLocal,
		loadRemote,
		applyLocal,
		applyRemote,
		onError,
	});
	return {
		sync,
		setNow: (value) => {
			now = value;
		},
		loadLocal,
		loadRemote,
		applyLocal,
		applyRemote,
		onError,
	};
}

describe("createModelCatalogSync", () => {
	let h: Harness;

	beforeEach(() => {
		h = createHarness();
	});

	it("首次 revalidate 拉取两个来源并写入", async () => {
		await h.sync.revalidate();
		expect(h.loadLocal).toHaveBeenCalledTimes(1);
		expect(h.loadRemote).toHaveBeenCalledTimes(1);
		expect(h.applyLocal).toHaveBeenCalledWith({ providers: {} });
		expect(h.applyRemote).toHaveBeenCalledWith({ "vetta-go": {} });
	});

	it("TTL 内的重复 revalidate 不再打接口", async () => {
		await h.sync.revalidate();
		h.setNow(1_000 + 59_999);
		await h.sync.revalidate();
		expect(h.loadRemote).toHaveBeenCalledTimes(1);
	});

	it("TTL 过期后重新拉取，后台改动能被看到", async () => {
		await h.sync.revalidate();
		h.loadRemote.mockResolvedValueOnce({ "vetta-go": { models: [{ id: "new-model" }] } });
		h.setNow(1_000 + 60_001);
		await h.sync.revalidate();
		expect(h.loadRemote).toHaveBeenCalledTimes(2);
		expect(h.applyRemote).toHaveBeenLastCalledWith({ "vetta-go": { models: [{ id: "new-model" }] } });
	});

	it("force 忽略 TTL", async () => {
		await h.sync.revalidate();
		await h.sync.revalidate({ force: true });
		expect(h.loadRemote).toHaveBeenCalledTimes(2);
	});

	it("sources 只校验指定来源", async () => {
		await h.sync.revalidate({ sources: ["remote"] });
		expect(h.loadRemote).toHaveBeenCalledTimes(1);
		expect(h.loadLocal).not.toHaveBeenCalled();
	});

	it("并发调用去重为一次请求", async () => {
		let release: (() => void) | undefined;
		h.loadRemote.mockImplementationOnce(
			() =>
				new Promise<Record<string, unknown>>((resolve) => {
					release = () => resolve({});
				}),
		);
		const first = h.sync.revalidate({ sources: ["remote"] });
		const second = h.sync.revalidate({ sources: ["remote"], force: true });
		release?.();
		await Promise.all([first, second]);
		expect(h.loadRemote).toHaveBeenCalledTimes(1);
	});

	it("拉取失败不写入、不刷新新鲜度，冷却后重试", async () => {
		h.loadRemote.mockRejectedValueOnce(new Error("offline"));
		await h.sync.revalidate({ sources: ["remote"] });
		expect(h.applyRemote).not.toHaveBeenCalled();
		expect(h.onError).toHaveBeenCalledWith("remote", expect.any(Error));

		// 冷却期内不重试
		h.setNow(1_000 + 9_999);
		await h.sync.revalidate({ sources: ["remote"] });
		expect(h.loadRemote).toHaveBeenCalledTimes(1);

		// 冷却结束后重试并成功
		h.setNow(1_000 + 10_001);
		await h.sync.revalidate({ sources: ["remote"] });
		expect(h.loadRemote).toHaveBeenCalledTimes(2);
		expect(h.applyRemote).toHaveBeenCalledTimes(1);
	});

	it("未登录（loadRemote 返回 null）不写入，也不把空目录当成新鲜数据", async () => {
		h.loadRemote.mockResolvedValueOnce(null);
		await h.sync.revalidate({ sources: ["remote"] });
		expect(h.applyRemote).not.toHaveBeenCalled();
	});

	it("invalidate 后下一次 revalidate 必定重新拉取", async () => {
		await h.sync.revalidate({ sources: ["local"] });
		h.sync.invalidate("local");
		await h.sync.revalidate({ sources: ["local"] });
		expect(h.loadLocal).toHaveBeenCalledTimes(2);
	});

	it("reset 清空全部新鲜度", async () => {
		await h.sync.revalidate();
		h.sync.reset();
		await h.sync.revalidate();
		expect(h.loadLocal).toHaveBeenCalledTimes(2);
		expect(h.loadRemote).toHaveBeenCalledTimes(2);
	});
});
