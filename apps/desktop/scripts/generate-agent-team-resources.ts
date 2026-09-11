// 从 @vetta/agent-team 的内置预设生成 resources/agent-teams —— 首次安装铺盘、以及存量安装
// 增量回填都只 copy 这棵目录。
//
// 为何要生成而不是运行时拼：装机目录必须和用户自己创建的资源长得一模一样（布局 v2 之后两者
// 不可区分），落盘格式的唯一权威是 AgentTeamFileRepository.write。手写目录迟早和它漂移，
// 新增预设时更容易整个忘掉——存量用户于是什么也拿不到。
//
// 触发：改动 packages/agent-team/src/initial-resources.ts 后跑 `bun run generate:agent-team-resources`。
// `--check` 由 check-guards 调用，只比对不写盘。

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type AgentProfile,
	BUILTIN_PRESET_GENERATION,
	createAgentTeamFixture,
	type TeamDefinition,
	type TeamMember,
} from "@vetta/agent-team";

const resourceRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "resources", "agent-teams");
const checkOnly = process.argv.includes("--check");

/** 与 agent-team-storage-layout 的同名函数必须逐字一致：目录名错位就等于预设发不出去。 */
function createAgentTeamStorageKey(name: string, id: string): string {
	const words = name
		.normalize("NFKC")
		.match(/[\p{L}\p{N}]+/gu)
		?.join("-")
		.toLocaleLowerCase("en-US");
	const slug = [...(words || "resource")].slice(0, 48).join("").replace(/[. ]+$/u, "") || "resource";
	const digest = createHash("sha256").update(id, "utf8").digest("hex").slice(0, 10);
	return `${slug}--${digest}`;
}

function serializeAgent(agent: AgentProfile): Record<string, unknown> {
	const { description: _description, systemPrompt: _systemPrompt, ...metadata } = agent;
	return metadata;
}

/** 任务书的补充指令是长文本，按 ADR-0106 落到独立 Markdown，不进 team.json。 */
function serializeMember(member: TeamMember): TeamMember {
	if (!member.assignment) return member;
	const { instructions: _instructions, ...assignment } = member.assignment;
	return { ...member, assignment };
}

function serializeTeam(team: TeamDefinition): Record<string, unknown> {
	const { description: _description, ...metadata } = team;
	return { ...metadata, members: team.members.map(serializeMember) };
}

const files = new Map<string, string>();

function emitJSON(path: string, value: unknown): void {
	files.set(path, `${JSON.stringify(value, null, "\t")}\n`);
}

function emitText(path: string, value: string): void {
	files.set(path, `${value}\n`);
}

const document = createAgentTeamFixture();
const agents: Record<string, string> = {};
const teams: Record<string, string> = {};

for (const agent of document.agents) {
	const directory = createAgentTeamStorageKey(agent.name, agent.id);
	agents[agent.id] = directory;
	emitJSON(join("agents", directory, "agent.json"), serializeAgent(agent));
	emitText(join("agents", directory, "description.md"), agent.description);
}

for (const team of document.teams) {
	const directory = createAgentTeamStorageKey(team.name, team.id);
	teams[team.id] = directory;
	emitJSON(join("teams", directory, "team.json"), serializeTeam(team));
	emitText(join("teams", directory, "description.md"), team.description);
	for (const member of team.members) {
		const instructions = member.assignment?.instructions;
		if (!instructions) continue;
		const fileName = `${createAgentTeamStorageKey(member.handle, member.id)}.md`;
		emitText(join("teams", directory, "members", fileName), instructions);
	}
}

emitJSON("index.json", {
	schemaVersion: document.schemaVersion,
	revision: document.revision,
	layoutVersion: 2,
	presetGeneration: BUILTIN_PRESET_GENERATION,
	teams,
	agents,
});

async function listExisting(root: string): Promise<string[]> {
	const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => relative(root, join(entry.parentPath, entry.name)))
		.sort();
}

const existing = await listExisting(resourceRoot);
const expected = [...files.keys()].sort();
const differences: string[] = [];

for (const path of expected) {
	const current = await readFile(join(resourceRoot, path), "utf8").catch(() => undefined);
	if (current !== files.get(path)) differences.push(current === undefined ? `missing: ${path}` : `stale: ${path}`);
}
for (const path of existing) {
	if (!files.has(path)) differences.push(`orphaned: ${path}`);
}

if (checkOnly) {
	if (differences.length > 0) {
		console.error("[agent-team-resources] resources/agent-teams 与内置预设不一致：");
		for (const difference of differences) console.error(`  ${difference}`);
		console.error("  跑 `bun run generate:agent-team-resources` 重新生成。");
		process.exit(1);
	}
	console.log(`[agent-team-resources] ok (${expected.length} file(s))`);
	process.exit(0);
}

if (differences.length === 0) {
	console.log(`[agent-team-resources] 已是最新 (${expected.length} file(s))`);
	process.exit(0);
}

await rm(resourceRoot, { recursive: true, force: true });
for (const [path, content] of files) {
	const target = join(resourceRoot, path);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, content);
}
console.log(`[agent-team-resources] 已生成 ${files.size} 个文件，${differences.length} 处变更`);
