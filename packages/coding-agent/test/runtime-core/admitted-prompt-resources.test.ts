import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeResourceAccess } from "@vetta/runtime-node/host";
import { expect, it } from "vitest";
import { AdmittedPromptResources } from "../../src/composition/turn/admitted-prompt-resources.js";
import { capturePromptResourceSource, capturePromptSkills } from "../../src/model-context/prompt-snapshot.js";
import {
	createTestResourcePackageRuntime,
	createTestSessionResourceRuntime,
} from "../fixtures/node-resource-runtime.js";

it("shares one admitted resource version, preserves existing bindings and retries failed or cancelled refresh", async () => {
	const root = await mkdtemp(join(tmpdir(), "admitted-prompt-resources-"));
	const skillDir = join(root, "skills");
	const skillPath = join(skillDir, "review.md");
	const base = createNodeResourceAccess();
	let rejectSkillRead = false;
	const raw = createTestSessionResourceRuntime({
		cwd: root,
		agentDir: root,
		includeAgentSkills: false,
		packages: createTestResourcePackageRuntime({
			cwd: root,
			agentDir: root,
			managedSkillsDir: join(root, "managed"),
		}),
		resourceAccess: {
			paths: { ...base.paths, homeDirectory: () => root },
			files: {
				...base.files,
				stat: async (path, options) => {
					if (rejectSkillRead && path === skillDir) throw new Error("unavailable");
					return base.files.stat(path, options);
				},
			},
		},
		skillLocations: {
			sceneDir: join(root, "scene"),
			managedSkillsDir: join(root, "managed"),
			manifestPath: join(root, "manifest.json"),
		},
	});
	try {
		await mkdir(skillDir);
		await writeFile(join(root, ".git"), "");
		await writeFile(skillPath, document("Original body"));
		await writeFile(join(root, "AGENTS.md"), "Original context");
		await raw.reload();
		const admitted = new AdmittedPromptResources(raw);
		await admitted.refresh();
		const first = await capturePromptResourceSource(admitted.source);
		await writeFile(skillPath, document("Updated body with different size"));
		await writeFile(join(root, "AGENTS.md"), "Updated context");
		// Concurrent binders must agree even if a file changes during binding.
		const [prompt, skills] = await Promise.all([
			capturePromptResourceSource(admitted.source),
			capturePromptSkills(admitted.source),
		]);
		expect(prompt.getSkills().skills[0].content).toContain("Original body");
		expect(skills[0].content).toContain("Original body");
		expect(prompt.getAgentsFiles()).toEqual(first.getAgentsFiles());

		rejectSkillRead = true;
		await expect(admitted.refresh()).rejects.toThrow("unavailable");
		expect(admitted.source.getAgentsFiles()).toEqual(first.getAgentsFiles());
		rejectSkillRead = false;
		const cancelled = new AbortController();
		cancelled.abort(new Error("cancelled"));
		await expect(admitted.refresh(cancelled.signal)).rejects.toThrow("cancelled");
		expect(admitted.source.getSkills().skills[0].content).toContain("Original body");

		await admitted.refresh();
		expect(admitted.source.getSkills().skills[0].content).toContain("Updated body");
		expect(admitted.source.getAgentsFiles().agentsFiles).toContainEqual(
			expect.objectContaining({ content: "Updated context" }),
		);
		expect(first.getSkills().skills[0].content).toContain("Original body");
		await rm(skillPath);
		await admitted.refresh();
		expect(admitted.source.getSkills().skills).toEqual([]);
		expect(first.getSkills().skills).toHaveLength(1);

		const pluginSkill = join(root, "plugin-review.md");
		await writeFile(pluginSkill, document("Plugin replacement"));
		await admitted.source.setRuntimeSkillPaths([pluginSkill]);
		expect(admitted.source.getSkills().skills[0].content).toContain("Plugin replacement");
		expect(first.getSkills().skills[0].content).toContain("Original body");
		await admitted.source.setRuntimeSkillPaths([]);
		expect(admitted.source.getSkills().skills).toEqual([]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

function document(body: string): string {
	return `---\nname: review\ndescription: Review changes\n---\n${body}\n`;
}
