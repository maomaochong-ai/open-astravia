import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	consumePendingUpdateRelaunch,
	hasPendingUpdateRelaunch,
	markPendingUpdateRelaunch,
} from "./update-relaunch-marker";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function stateDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "astravia-relaunch-marker-"));
	roots.push(dir);
	return dir;
}

describe("update relaunch marker", () => {
	it("is consumed exactly once", async () => {
		const dir = await stateDir();
		markPendingUpdateRelaunch(dir);

		expect(consumePendingUpdateRelaunch(dir)).toBe(true);
		// 第二次必须是 false：否则之后每次手动启动都会抢焦点。
		expect(consumePendingUpdateRelaunch(dir)).toBe(false);
	});

	it("answers the read-only question the single-instance retry depends on", async () => {
		const dir = await stateDir();
		expect(hasPendingUpdateRelaunch(dir)).toBe(false);

		markPendingUpdateRelaunch(dir);
		expect(hasPendingUpdateRelaunch(dir)).toBe(true);
		// 只读：问过之后标记仍在，它只由启动完成后的消费方删掉。
		expect(hasPendingUpdateRelaunch(dir)).toBe(true);
		expect(consumePendingUpdateRelaunch(dir)).toBe(true);
		expect(hasPendingUpdateRelaunch(dir)).toBe(false);
	});

	it("reports false when the app was not relaunched by the installer", async () => {
		expect(consumePendingUpdateRelaunch(await stateDir())).toBe(false);
	});

	it("never throws on an unwritable state dir", async () => {
		expect(() => markPendingUpdateRelaunch("/nonexistent/astravia-state")).not.toThrow();
		expect(consumePendingUpdateRelaunch("/nonexistent/astravia-state")).toBe(false);
	});
});
