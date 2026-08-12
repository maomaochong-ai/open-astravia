/**
 * 工作区性质探测：把 cwd 的客观事实（是否 Git 仓库、是什么技术栈的既有工程）
 * 渲染成一段可注入系统提示词的英文事实描述。
 *
 * 事实比规则更强：模型读到「写一个前台页面」时手上直接有消歧依据，不必先 ls 才知道
 * 自己身处一个既有代码库，也就不会误起一个独立的新工程。
 *
 * 结果在会话创建时探测一次并固化，不逐轮重算，否则会造成系统提示词前缀缓存抖动。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface WorkspaceSignals {
	/** cwd 下存在 `.git`。 */
	readonly isGitRepository: boolean;
	/** `package.json` 中可解析的 `name` 字段。 */
	readonly packageName?: string;
	/** 按稳定顺序去重的技术栈标识，例如 `["Node.js", "TypeScript", "React"]`。 */
	readonly stacks: readonly string[];
}

/** 标记文件 → 技术栈标识。顺序即渲染顺序。 */
const markerFileStacks: ReadonlyArray<readonly [file: string, stack: string]> = [
	["package.json", "Node.js"],
	["tsconfig.json", "TypeScript"],
	["deno.json", "Deno"],
	["go.mod", "Go"],
	["Cargo.toml", "Rust"],
	["pyproject.toml", "Python"],
	["requirements.txt", "Python"],
	["setup.py", "Python"],
	["Gemfile", "Ruby"],
	["composer.json", "PHP"],
	["pubspec.yaml", "Dart/Flutter"],
	["pom.xml", "Java (Maven)"],
	["build.gradle", "Java/Kotlin (Gradle)"],
	["build.gradle.kts", "Java/Kotlin (Gradle)"],
	["CMakeLists.txt", "C/C++ (CMake)"],
];

/** npm 依赖名 → 框架标识。顺序即渲染顺序。 */
const dependencyStacks: ReadonlyArray<readonly [dependency: string, stack: string]> = [
	["next", "Next.js"],
	["nuxt", "Nuxt"],
	["@remix-run/react", "Remix"],
	["astro", "Astro"],
	["@angular/core", "Angular"],
	["svelte", "Svelte"],
	["vue", "Vue"],
	["react", "React"],
	["solid-js", "SolidJS"],
	["vite", "Vite"],
	["electron", "Electron"],
	["@nestjs/core", "NestJS"],
	["express", "Express"],
	["tailwindcss", "Tailwind CSS"],
];

/** 从文件系统探测 cwd 的工作区信号。调用方负责处理异常。 */
export function probeWorkspaceSignals(cwd: string): WorkspaceSignals {
	const stacks: string[] = [];
	for (const [file, stack] of markerFileStacks) {
		if (existsSync(join(cwd, file)) && !stacks.includes(stack)) stacks.push(stack);
	}
	const manifest = readPackageManifest(join(cwd, "package.json"));
	for (const [dependency, stack] of dependencyStacks) {
		if (manifest?.dependencyNames.has(dependency) && !stacks.includes(stack)) stacks.push(stack);
	}
	return {
		isGitRepository: existsSync(join(cwd, ".git")),
		...(manifest?.name ? { packageName: manifest.name } : {}),
		stacks,
	};
}

/** 把工作区信号渲染成事实段落；没有任何信号时返回 undefined（不注入空段落）。 */
export function renderWorkspaceFacts(signals: WorkspaceSignals): string | undefined {
	const facts: string[] = [];
	if (signals.isGitRepository) facts.push("It is a Git repository.");
	if (signals.packageName) facts.push(`Its package manifest declares the project name \`${signals.packageName}\`.`);
	if (signals.stacks.length > 0) facts.push(`Detected stack: ${signals.stacks.join(", ")}.`);
	if (facts.length === 0) return undefined;

	return [
		"# Workspace",
		"",
		"Facts about the current working directory, detected once when this session started:",
		"",
		...facts.map((fact) => `- ${fact}`),
		"",
		"This directory is an existing codebase, not an empty scratch space. Carry out the user's request inside it, " +
			"reusing its existing stack, structure, and conventions — including for UI and page work. " +
			"Do NOT scaffold a separate standalone project, sandbox, or design mock unless the user explicitly asks for one.",
	].join("\n");
}

/**
 * 探测并渲染工作区事实。探测失败静默降级为 undefined，绝不让会话创建失败。
 * `probe` 参数只用于测试注入。
 */
export function detectWorkspaceFacts(
	cwd: string,
	probe: (cwd: string) => WorkspaceSignals = probeWorkspaceSignals,
): string | undefined {
	try {
		return renderWorkspaceFacts(probe(cwd));
	} catch {
		return undefined;
	}
}

interface PackageManifestFacts {
	readonly name?: string;
	readonly dependencyNames: ReadonlySet<string>;
}

function readPackageManifest(path: string): PackageManifestFacts | undefined {
	if (!existsSync(path)) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return undefined;
	}
	if (typeof parsed !== "object" || parsed === null) return undefined;
	const manifest = parsed as Record<string, unknown>;
	const dependencyNames = new Set<string>();
	for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
		const value = manifest[field];
		if (typeof value === "object" && value !== null) {
			for (const name of Object.keys(value)) dependencyNames.add(name);
		}
	}
	return {
		...(typeof manifest.name === "string" && manifest.name.trim() ? { name: manifest.name.trim() } : {}),
		dependencyNames,
	};
}
