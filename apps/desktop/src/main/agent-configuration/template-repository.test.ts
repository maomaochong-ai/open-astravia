import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_AGENT_CONFIGURATION } from "@vetta/coding-agent/profile";
import { afterEach, describe, expect, it } from "vitest";
import { AgentTemplateRepository } from "./template-repository.js";

describe("Agent template repository", () => {
	const directories: string[] = [];
	afterEach(async () => {
		for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
	});

	it("persists revisions, rejects stale writers, restores templates and deletes without changing saved copies", async () => {
		const { repository, path } = await fixture();
		expect(await repository.list()).toEqual([]);
		const first = await repository.save({
			expectedRevision: 0,
			name: "Writer",
			configuration: DEFAULT_AGENT_CONFIGURATION,
		});
		const results = await Promise.allSettled([
			repository.save({
				id: first.id,
				expectedRevision: 1,
				name: "Writer 2",
				configuration: DEFAULT_AGENT_CONFIGURATION,
			}),
			repository.save({
				id: first.id,
				expectedRevision: 1,
				name: "Stale writer",
				configuration: DEFAULT_AGENT_CONFIGURATION,
			}),
		]);
		expect(results[0].status).toBe("fulfilled");
		expect(results[1]).toMatchObject({ status: "rejected", reason: { code: "AGENT_CONFIGURATION_CONFLICT" } });
		expect(await new AgentTemplateRepository(path).list()).toMatchObject([
			{ id: first.id, revision: 2, name: "Writer 2" },
		]);
		await expect(repository.delete(first.id, 1)).rejects.toThrow("AGENT_CONFIGURATION_CONFLICT");
		await repository.delete(first.id, 2);
		expect(await repository.list()).toEqual([]);
		expect(first).toMatchObject({ revision: 1, name: "Writer" });
	});

	it("checks the formatted on-disk size before replacing a valid compact file", async () => {
		const { path } = await fixture();
		const template = { id: "writer", name: "Writer", revision: 1, configuration: DEFAULT_AGENT_CONFIGURATION };
		const content = JSON.stringify({ schemaVersion: 1, templates: [template] });
		await writeFile(path, content);
		const repository = new AgentTemplateRepository(path, Buffer.byteLength(content, "utf8") + 10);
		await expect(
			repository.save({
				id: "writer",
				expectedRevision: 1,
				name: "Writer",
				configuration: DEFAULT_AGENT_CONFIGURATION,
			}),
		).rejects.toThrow("AGENT_CONFIGURATION_INVALID");
		expect(await readFile(path, "utf8")).toBe(content);
	});

	it.each([
		"invalid JSON",
		JSON.stringify({ schemaVersion: 2, templates: [] }),
		JSON.stringify({ schemaVersion: 1, templates: [{ id: "bad", config: { credential: "secret" } }] }),
	])("does not overwrite invalid or future files", async (content) => {
		const { repository, path } = await fixture();
		await writeFile(path, content);
		await expect(
			repository.save({ expectedRevision: 0, name: "New", configuration: DEFAULT_AGENT_CONFIGURATION }),
		).rejects.toThrow("AGENT_CONFIGURATION_INVALID");
		expect(await readFile(path, "utf8")).toBe(content);
	});

	async function fixture() {
		const directory = await mkdtemp(join(tmpdir(), "agent-templates-"));
		directories.push(directory);
		const path = join(directory, "templates.json");
		return { path, repository: new AgentTemplateRepository(path) };
	}
});
