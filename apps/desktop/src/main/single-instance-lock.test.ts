import { describe, expect, it } from "vitest";

import {
	acquireSingleInstanceLockWithRetry,
	SINGLE_INSTANCE_RETRY_INTERVAL_MS,
	SINGLE_INSTANCE_RETRY_TIMEOUT_MS,
} from "./single-instance-lock";

/** 用可控时钟代替真实睡眠：每次 sleep 都把虚拟时间往前推。 */
function fakeClock(): { now: () => number; sleep: (ms: number) => void; sleeps: number[] } {
	let current = 0;
	const sleeps: number[] = [];
	return {
		now: () => current,
		sleep: (ms) => {
			sleeps.push(ms);
			current += ms;
		},
		sleeps,
	};
}

describe("single instance lock retry", () => {
	it("returns immediately when the lock is free", () => {
		const clock = fakeClock();
		const acquired = acquireSingleInstanceLockWithRetry(() => true, {
			retry: true,
			sleep: clock.sleep,
			now: clock.now,
		});

		expect(acquired).toBe(true);
		expect(clock.sleeps).toEqual([]);
	});

	it("gives up at once for an ordinary second launch", () => {
		const clock = fakeClock();
		let attempts = 0;
		const acquired = acquireSingleInstanceLockWithRetry(
			() => {
				attempts += 1;
				return false;
			},
			{ retry: false, sleep: clock.sleep, now: clock.now },
		);

		// 旧实例还活着：它自己的 second-instance 会把窗口拉到前台，这里不该等。
		expect(acquired).toBe(false);
		expect(attempts).toBe(1);
		expect(clock.sleeps).toEqual([]);
	});

	it("keeps retrying an update relaunch until the quitting instance releases the lock", () => {
		const clock = fakeClock();
		let attempts = 0;
		const acquired = acquireSingleInstanceLockWithRetry(
			() => {
				attempts += 1;
				// 旧进程退出后才拿得到：前两次都被拒。
				return attempts > 2;
			},
			{ retry: true, sleep: clock.sleep, now: clock.now },
		);

		expect(acquired).toBe(true);
		expect(attempts).toBe(3);
		expect(clock.sleeps).toHaveLength(2);
		expect(clock.sleeps.every((ms) => ms === SINGLE_INSTANCE_RETRY_INTERVAL_MS)).toBe(true);
	});

	it("stops after the timeout instead of hanging the launch", () => {
		const clock = fakeClock();
		let attempts = 0;
		const acquired = acquireSingleInstanceLockWithRetry(
			() => {
				attempts += 1;
				return false;
			},
			{ retry: true, sleep: clock.sleep, now: clock.now },
		);

		expect(acquired).toBe(false);
		expect(attempts).toBe(SINGLE_INSTANCE_RETRY_TIMEOUT_MS / SINGLE_INSTANCE_RETRY_INTERVAL_MS + 1);
	});
});
