import { describe, expect, test } from "vitest";
import {
	introspectionInFlight,
	introspectionQueued,
	MAX_CONCURRENT_INTROSPECTION,
	runIntrospection,
} from "./introspection-limiter";

/** 排空当前宏任务之前的全部微任务（pump 用微任务启动任务）。 */
function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 受控任务：记录开始/结束顺序，返回可手动放行的 Promise。 */
function deferredGate() {
	let resolveFn!: () => void;
	const promise = new Promise<void>((resolve) => {
		resolveFn = resolve;
	});
	return { promise, resolve: resolveFn };
}

function controlledTask(log: string[], name: string) {
	const gate = deferredGate();
	const promise = runIntrospection(async () => {
		log.push(`start:${name}`);
		await gate.promise;
		log.push(`end:${name}`);
		return name;
	});
	return { promise, release: gate.resolve };
}

/** 创建任务并等待 pump 把任务实际调度执行（log 出现 start 为止）。 */
async function startedTask(log: string[], name: string) {
	const task = controlledTask(log, name);
	await tick();
	expect(log).toContain(`start:${name}`);
	return task;
}

describe("runIntrospection", () => {
	test("低于并发上限时立即执行、无排队", async () => {
		const log: string[] = [];
		const a = await startedTask(log, "a");
		expect(introspectionInFlight()).toBe(1);
		expect(introspectionQueued()).toBe(0);
		a.release();
		await expect(a.promise).resolves.toBe("a");
		expect(log).toEqual(["start:a", "end:a"]);
		expect(introspectionInFlight()).toBe(0);
	});

	test("超上限的任务排队，且按 FIFO 放行", async () => {
		const log: string[] = [];
		const a = await startedTask(log, "a");
		const b = await startedTask(log, "b"); // 第二个在途（2/2）
		const c = controlledTask(log, "c"); // 超上限 → 排队
		await tick();
		expect(introspectionInFlight()).toBe(2);
		expect(introspectionQueued()).toBe(1);
		expect(log).toEqual(["start:a", "start:b"]);
		expect(log.includes("start:c")).toBe(false);

		a.release(); // a 结束 → 按 FIFO 放行 c
		await tick();
		expect(log).toEqual(["start:a", "start:b", "end:a", "start:c"]);
		b.release();
		await b.promise;
		c.release();
		await expect(c.promise).resolves.toBe("c");
		expect(log).toEqual(["start:a", "start:b", "end:a", "start:c", "end:b", "end:c"]);
		expect(introspectionInFlight()).toBe(0);
		expect(introspectionQueued()).toBe(0);
	});

	test("任务抛错时原样传播且释放槽位", async () => {
		const boom = runIntrospection(async () => {
			throw new Error("db exploded");
		});
		await expect(boom).rejects.toThrow("db exploded");
		// 槽位已释放，后续任务可直接执行
		const ok = await runIntrospection(async () => "fine");
		expect(ok).toBe("fine");
		expect(introspectionInFlight()).toBe(0);
		expect(introspectionQueued()).toBe(0);
	});

	test("结果原样返回（含 falsy 值）", async () => {
		const falsy = await runIntrospection(async () => []);
		expect(falsy).toEqual([]);
		const zero = await runIntrospection(async () => 0);
		expect(zero).toBe(0);
	});

	test("释放后放行排队任务，直到回到上限", async () => {
		const log: string[] = [];
		const t0 = await startedTask(log, "t0");
		const t1 = await startedTask(log, "t1");
		const t2 = controlledTask(log, "t2");
		const t3 = controlledTask(log, "t3");
		const t4 = controlledTask(log, "t4");
		await tick();
		expect(introspectionInFlight()).toBe(MAX_CONCURRENT_INTROSPECTION);
		expect(introspectionQueued()).toBe(3);

		// 释放两个在途 → 两个排队任务进入在途
		t0.release();
		t1.release();
		await t0.promise;
		await t1.promise;
		await tick();
		expect(introspectionInFlight()).toBe(2);
		expect(introspectionQueued()).toBe(1);
		expect(log).toEqual(["start:t0", "start:t1", "end:t0", "end:t1", "start:t2", "start:t3"]);

		// 收尾
		t2.release();
		await t2.promise;
		t3.release();
		await t3.promise;
		t4.release();
		await expect(t4.promise).resolves.toBe("t4");
		expect(log).toEqual([
			"start:t0",
			"start:t1",
			"end:t0",
			"end:t1",
			"start:t2",
			"start:t3",
			"end:t2",
			"start:t4", // t2 结束按 FIFO 放行队尾 t4（早于 t3 手动释放）
			"end:t3",
			"end:t4",
		]);
		expect(introspectionQueued()).toBe(0);
		expect(introspectionInFlight()).toBe(0);
	});
});
