import type { PluginAppActionExample, PluginContext, PluginJsonSchema } from "@vetta-org/plugin-sdk";
import { throwEntityNotFound } from "../action-errors";
import { createVettaActionRegistrar } from "../action-usage";

type ProjectsQueryInput =
	| { operation: "help" }
	| { operation: "list" }
	| { operation: "list-sessions"; cwd: string }
	| { operation: "list-runtime-projects" };
type ProjectsManageInput =
	| { operation: "create"; name: string; path?: string }
	| { operation: "open"; path: string; name?: string }
	| { operation: "rename"; path: string; name: string }
	| { operation: "archive"; path: string }
	| { operation: "unarchive"; path: string }
	| { operation: "remove"; path: string };

const querySchema: PluginJsonSchema = {
	type: "object",
	oneOf: [
		{ properties: { operation: { const: "help" } }, required: ["operation"], additionalProperties: false },
		{ properties: { operation: { const: "list" } }, required: ["operation"], additionalProperties: false },
		{
			properties: {
				operation: { const: "list-sessions" },
				cwd: { type: "string", minLength: 1 },
			},
			required: ["operation", "cwd"],
			additionalProperties: false,
		},
		{
			properties: { operation: { const: "list-runtime-projects" } },
			required: ["operation"],
			additionalProperties: false,
		},
	],
};

const manageSchema: PluginJsonSchema = {
	type: "object",
	oneOf: [
		{
			properties: {
				operation: { const: "create" },
				name: { type: "string", minLength: 1 },
				path: { type: "string", minLength: 1 },
			},
			required: ["operation", "name"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "open" },
				path: { type: "string", minLength: 1 },
				name: { type: "string", minLength: 1 },
			},
			required: ["operation", "path"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "rename" },
				path: { type: "string", minLength: 1 },
				name: { type: "string", minLength: 1 },
			},
			required: ["operation", "path", "name"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "archive" },
				path: { type: "string", minLength: 1 },
			},
			required: ["operation", "path"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "unarchive" },
				path: { type: "string", minLength: 1 },
			},
			required: ["operation", "path"],
			additionalProperties: false,
		},
		{
			properties: {
				operation: { const: "remove" },
				path: { type: "string", minLength: 1 },
			},
			required: ["operation", "path"],
			additionalProperties: false,
		},
	],
};

const queryExamples: PluginAppActionExample<ProjectsQueryInput>[] = [
	{ description: "列出侧边栏项目", input: { operation: "list" } },
	{ description: "列出会话", input: { operation: "list-sessions", cwd: "C:\\\\workspace\\\\demo" } },
];
const manageExamples: PluginAppActionExample<ProjectsManageInput>[] = [
	{ description: "创建项目", input: { operation: "create", name: "demo" } },
	{ description: "归档项目", input: { operation: "archive", path: "C:\\\\workspace\\\\demo" } },
];

function samePath(a: string, b: string): boolean {
	return a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();
}

export function registerProjectsActions(ctx: PluginContext): void {
	const register = createVettaActionRegistrar(ctx, "projects");
	register<ProjectsQueryInput>({
		id: "projects.query",
		publicId: "projects.query",
		title: "查询项目与会话",
		summary: "列出侧边栏项目、runtime 项目或指定 cwd 的会话列表。",
		description:
			'对象参数；operation 为 "help"、"list"、"list-sessions" 或 "list-runtime-projects"。list 返回侧边栏 config 项目。',
		keywords: ["项目", "project", "会话", "session", "侧边栏", "归档", "workspace"],
		effect: "read",
		inputSchema: querySchema,
		examples: queryExamples,
		handler: async ({ input }) => {
			if (input.operation === "help") {
				return {
					guidance: "侧边栏项目与 runtime session 项目不是同一数据源；批量/定时任务另有专用 Action。",
					actions: [
						{ id: "projects.query", inputSchema: querySchema, examples: queryExamples },
						{ id: "projects.manage", inputSchema: manageSchema, examples: manageExamples },
					],
				};
			}
			if (input.operation === "list") return ctx.official.projects.list();
			if (input.operation === "list-runtime-projects") {
				return { projects: await ctx.official.projects.listRuntimeProjects() };
			}
			return {
				cwd: input.cwd,
				sessions: await ctx.official.projects.listSessions(input.cwd),
			};
		},
	});
	register<ProjectsManageInput>({
		id: "projects.manage",
		publicId: "projects.manage",
		title: "管理侧边栏项目",
		summary: "创建、打开、重命名、归档或移出侧边栏项目。",
		description:
			'对象参数；operation 为 "create"、"open"、"rename"、"archive"、"unarchive" 或 "remove"。create 默认在 workspacePath 下建目录；remove 只移出侧边栏，不删磁盘。',
		keywords: ["项目", "创建项目", "归档", "打开项目", "workspace"],
		effect: "write",
		approval: {
			defaultPresentation: "projects.create",
			presentations: [
				{ id: "projects.create", title: "创建项目确认", description: "展示并可编辑待创建项目。" },
				{ id: "projects.open", title: "打开项目确认", description: "展示并可编辑待打开项目路径。" },
				{ id: "projects.rename", title: "重命名项目确认", description: "展示并可编辑项目名称。" },
				{ id: "projects.archive", title: "归档项目确认", description: "展示待归档项目。" },
				{ id: "projects.unarchive", title: "取消归档项目确认", description: "展示待恢复项目。" },
				{ id: "projects.remove", title: "移除项目确认", description: "展示待移除项目。" },
			],
			presentationByOperation: {
				create: "projects.create",
				open: "projects.open",
				rename: "projects.rename",
				archive: "projects.archive",
				unarchive: "projects.unarchive",
				remove: "projects.remove",
			},
		},
		inputSchema: manageSchema,
		examples: manageExamples,
		assertReady: async ({ input }) => {
			if (input.operation === "create" || input.operation === "open") return;
			const snapshot = await ctx.official.projects.list();
			const activePaths = snapshot.projects.map((entry) => entry.path);
			const archivedPaths = snapshot.archivedProjects.map((entry) => entry.path);
			const active = snapshot.projects.find((entry) => samePath(entry.path, input.path));
			const archived = snapshot.archivedProjects.find((entry) => samePath(entry.path, input.path));
			if (input.operation === "archive" && !active) {
				throwEntityNotFound({
					operation: input.operation,
					entity: "active sidebar project",
					idField: "path",
					id: input.path,
					queryAction: "projects.query",
					queryExample: { operation: "list" },
					resultIdPath: "projects[].path (active list)",
					availableIds: activePaths,
					extra: "archive only works on active projects.",
				});
			}
			if (input.operation === "unarchive" && !archived) {
				throwEntityNotFound({
					operation: input.operation,
					entity: "archived sidebar project",
					idField: "path",
					id: input.path,
					queryAction: "projects.query",
					queryExample: { operation: "list" },
					resultIdPath: "archivedProjects[].path",
					availableIds: archivedPaths,
					extra: "unarchive only works on archived projects.",
				});
			}
			if (!active && !archived) {
				throwEntityNotFound({
					operation: input.operation,
					entity: "sidebar project",
					idField: "path",
					id: input.path,
					queryAction: "projects.query",
					queryExample: { operation: "list" },
					resultIdPath: "projects[].path or archivedProjects[].path",
					availableIds: [...activePaths, ...archivedPaths],
					extra: "Use absolute path exactly as returned by projects.query list.",
				});
			}
		},
		handler: async ({ input }) => {
			if (input.operation === "create") {
				const entry = await ctx.official.projects.create(input.name, input.path);
				return { operation: input.operation, ...entry };
			}
			if (input.operation === "open") {
				const entry = await ctx.official.projects.open(input.path, input.name);
				return { operation: input.operation, path: entry.path };
			}
			if (input.operation === "rename") {
				const entry = await ctx.official.projects.rename(input.path, input.name);
				return { operation: input.operation, path: entry.path, name: entry.name };
			}
			if (input.operation === "archive") {
				await ctx.official.projects.archive(input.path);
				return { operation: input.operation, path: input.path };
			}
			if (input.operation === "unarchive") {
				await ctx.official.projects.unarchive(input.path);
				return { operation: input.operation, path: input.path };
			}
			await ctx.official.projects.remove(input.path);
			return { operation: input.operation, path: input.path };
		},
	});
}
