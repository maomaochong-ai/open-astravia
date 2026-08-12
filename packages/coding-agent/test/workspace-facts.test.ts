import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	detectWorkspaceFacts,
	probeWorkspaceSignals,
	renderWorkspaceFacts,
	type WorkspaceSignals,
} from "../src/model-context/workspace-facts.js";

const createdDirs: string[] = [];

afterEach(() => {
	for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createWorkspace(files: Record<string, string>, dirs: string[] = []): string {
	const root = mkdtempSync(join(tmpdir(), "vetta-workspace-facts-"));
	createdDirs.push(root);
	for (const dir of dirs) mkdirSync(join(root, dir), { recursive: true });
	for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content, "utf-8");
	return root;
}

describe("probeWorkspaceSignals", () => {
	it("detects a Git repository with a Node/TypeScript framework stack", () => {
		const cwd = createWorkspace(
			{
				"package.json": JSON.stringify({
					name: "acme-web",
					dependencies: { react: "^19.0.0", next: "^15.0.0" },
					devDependencies: { vite: "^7.0.0" },
				}),
				"tsconfig.json": "{}",
			},
			[".git"],
		);

		expect(probeWorkspaceSignals(cwd)).toEqual({
			isGitRepository: true,
			packageName: "acme-web",
			stacks: ["Node.js", "TypeScript", "Next.js", "React", "Vite"],
		});
	});

	it("detects non-Node marker files", () => {
		const cwd = createWorkspace({ "go.mod": "module example.com/x\n" });

		expect(probeWorkspaceSignals(cwd)).toEqual({ isGitRepository: false, stacks: ["Go"] });
	});

	it("degrades to no signals for an empty directory", () => {
		const cwd = createWorkspace({});

		expect(probeWorkspaceSignals(cwd)).toEqual({ isGitRepository: false, stacks: [] });
	});

	it("ignores an unparsable package.json but keeps the marker-file signal", () => {
		const cwd = createWorkspace({ "package.json": "{ not json" });

		expect(probeWorkspaceSignals(cwd)).toEqual({ isGitRepository: false, stacks: ["Node.js"] });
	});
});

describe("renderWorkspaceFacts", () => {
	it("renders detected facts plus the do-not-scaffold constraint", () => {
		const signals: WorkspaceSignals = {
			isGitRepository: true,
			packageName: "acme-web",
			stacks: ["Node.js", "React"],
		};

		const rendered = renderWorkspaceFacts(signals);

		expect(rendered).toContain("# Workspace");
		expect(rendered).toContain("- It is a Git repository.");
		expect(rendered).toContain("`acme-web`");
		expect(rendered).toContain("Detected stack: Node.js, React.");
		expect(rendered).toContain("Do NOT scaffold a separate standalone project");
	});

	it("returns undefined when nothing was detected", () => {
		expect(renderWorkspaceFacts({ isGitRepository: false, stacks: [] })).toBeUndefined();
	});
});

describe("detectWorkspaceFacts", () => {
	it("returns rendered facts on a hit", () => {
		const cwd = createWorkspace({ "Cargo.toml": "[package]\n" }, [".git"]);

		expect(detectWorkspaceFacts(cwd)).toContain("Detected stack: Rust.");
	});

	it("returns undefined on a miss", () => {
		expect(detectWorkspaceFacts(createWorkspace({}))).toBeUndefined();
	});

	it("silently degrades when probing throws", () => {
		expect(
			detectWorkspaceFacts("/whatever", () => {
				throw new Error("EACCES");
			}),
		).toBeUndefined();
	});
});
