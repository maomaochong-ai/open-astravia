import { describe, expect, it } from "vitest";

import { scheduleWindowsQuitWatchdog } from "./windows-quit-watchdog";

interface Scheduled {
	callback: () => void;
	delayMs: number;
}

function manualScheduler(): { scheduled: Scheduled[]; schedule: (cb: () => void, ms: number) => void } {
	const scheduled: Scheduled[] = [];
	return { scheduled, schedule: (callback, delayMs) => scheduled.push({ callback, delayMs }) };
}

describe("windows quit watchdog", () => {
	it("waits for the timeout before touching the process", () => {
		const scheduler = manualScheduler();
		const events: string[] = [];

		scheduleWindowsQuitWatchdog({
			timeoutMs: 8_000,
			relaunch: () => {
				events.push("relaunch");
				return true;
			},
			exit: () => events.push("exit"),
			schedule: scheduler.schedule,
		});

		expect(events).toEqual([]);
		expect(scheduler.scheduled).toHaveLength(1);
		expect(scheduler.scheduled[0].delayMs).toBe(8_000);
	});

	it("starts the new version before hard exiting", () => {
		const scheduler = manualScheduler();
		const events: string[] = [];

		scheduleWindowsQuitWatchdog({
			timeoutMs: 8_000,
			relaunch: () => {
				events.push("relaunch");
				return true;
			},
			exit: () => events.push("exit"),
			schedule: scheduler.schedule,
		});
		scheduler.scheduled[0].callback();

		// 硬退出不会替我们 spawn relaunch 目标，所以顺序必须是「先拉起、再退出」。
		expect(events).toEqual(["relaunch", "exit"]);
	});

	it("still exits when no prepared executable is available", () => {
		const scheduler = manualScheduler();
		const events: string[] = [];
		const logs: string[] = [];

		scheduleWindowsQuitWatchdog({
			timeoutMs: 8_000,
			relaunch: () => false,
			exit: () => events.push("exit"),
			log: (message) => logs.push(message),
			schedule: scheduler.schedule,
		});
		scheduler.scheduled[0].callback();

		expect(events).toEqual(["exit"]);
		expect(logs.join("\n")).toContain("no prepared Windows executable");
	});

	it("exits even when starting the new version throws", () => {
		const scheduler = manualScheduler();
		const events: string[] = [];
		const logs: string[] = [];

		scheduleWindowsQuitWatchdog({
			timeoutMs: 8_000,
			relaunch: () => {
				throw new Error("spawn EACCES");
			},
			exit: () => events.push("exit"),
			log: (message) => logs.push(message),
			schedule: scheduler.schedule,
		});
		scheduler.scheduled[0].callback();

		expect(events).toEqual(["exit"]);
		expect(logs.join("\n")).toContain("spawn EACCES");
	});
});
