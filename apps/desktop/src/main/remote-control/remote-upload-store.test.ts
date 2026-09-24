import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type RemoteUploadStoreDependencies, safeUploadName, saveRemoteUpload } from "./remote-upload-store.js";

const roots: string[] = [];

async function store(now = Date.now()): Promise<RemoteUploadStoreDependencies> {
	const root = await mkdtemp(join(tmpdir(), "vetta-uploads-"));
	roots.push(root);
	let next = 0;
	return { root, mkdir, readdir, rm, stat, writeFile, now: () => now, id: () => `u${++next}` };
}

afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("remote upload store", () => {
	it("keeps a phone's file name but never lets it leave its directory", () => {
		expect(safeUploadName("周报.pdf", "file")).toBe("周报.pdf");
		expect(safeUploadName("../../etc/passwd", "file")).toBe("_.._etc_passwd");
		expect(safeUploadName("..\\secret", "file")).toBe("_secret");
		expect(safeUploadName(".bashrc", "file")).toBe("bashrc");
		expect(safeUploadName("  ", "image")).toBe("image");
		const long = `${"a".repeat(200)}.jpeg`;
		expect(safeUploadName(long, "image")).toHaveLength(80);
		expect(safeUploadName(long, "image").endsWith(".jpeg")).toBe(true);
	});

	it("writes each upload to its own directory under the session", async () => {
		const deps = await store();
		const first = await saveRemoteUpload(
			"key-1",
			{ kind: "file", name: "a.txt", mimeType: "text/plain", bytes: Buffer.from("one") },
			deps,
		);
		const second = await saveRemoteUpload(
			"key-1",
			{ kind: "file", name: "a.txt", mimeType: "text/plain", bytes: Buffer.from("two") },
			deps,
		);
		expect(relative(deps.root, first)).toBe(join("key-1", "u1", "a.txt"));
		expect(relative(deps.root, second)).toBe(join("key-1", "u2", "a.txt"));
		expect(await readFile(first, "utf8")).toBe("one");
		expect(await readFile(second, "utf8")).toBe("two");
	});

	it("sweeps uploads older than a week on the next write", async () => {
		const now = Date.now();
		const deps = await store(now);
		const old = await saveRemoteUpload(
			"key-1",
			{ kind: "image", name: "old.jpg", mimeType: "image/jpeg", bytes: Buffer.from("x") },
			deps,
		);
		const eightDaysAgo = (now - 8 * 24 * 60 * 60 * 1000) / 1000;
		await utimes(join(old, ".."), eightDaysAgo, eightDaysAgo);
		await saveRemoteUpload(
			"key-1",
			{ kind: "image", name: "new.jpg", mimeType: "image/jpeg", bytes: Buffer.from("y") },
			deps,
		);
		expect(await readdir(join(deps.root, "key-1"))).toEqual(["u2"]);
	});
});
