import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentAvatarRoot, storeAgentAvatarFile } from "./agent-avatar-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
	await rm(agentAvatarRoot(), { recursive: true, force: true });
});

async function createSource(name: string, bytes: Buffer): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "vetta-avatar-"));
	temporaryDirectories.push(directory);
	const path = join(directory, name);
	await writeFile(path, bytes);
	return path;
}

describe("Agent avatar store", () => {
	it("copies the picked image and returns a URL the renderer can load", async () => {
		const source = await createSource("portrait.PNG", Buffer.from("image-bytes"));

		const stored = await storeAgentAvatarFile(source);

		expect(stored.path.startsWith(agentAvatarRoot())).toBe(true);
		expect(stored.path.endsWith(".png")).toBe(true);
		expect(stored.url.startsWith("vetta-file://local/")).toBe(true);
		expect(await readFile(stored.path, "utf8")).toBe("image-bytes");
	});

	it("gives every upload its own name so a re-upload cannot repaint other agents", async () => {
		const source = await createSource("portrait.png", Buffer.from("image-bytes"));

		const first = await storeAgentAvatarFile(source);
		const second = await storeAgentAvatarFile(source);

		expect(first.path).not.toBe(second.path);
	});

	it("rejects file types the renderer must not load", async () => {
		const source = await createSource("portrait.svg", Buffer.from("<svg onload='alert(1)'/>"));

		await expect(storeAgentAvatarFile(source)).rejects.toThrow(/Unsupported avatar image type/);
	});

	it("rejects an image beyond the size cap", async () => {
		const source = await createSource("huge.png", Buffer.alloc(5 * 1024 * 1024 + 1));

		await expect(storeAgentAvatarFile(source)).rejects.toThrow(/larger than/);
	});
});
