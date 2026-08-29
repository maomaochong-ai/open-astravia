import type { I18nConfig } from "fumadocs-core/i18n";
import type { I18nProviderProps } from "fumadocs-ui/contexts/i18n";

export type DocsLanguage = "zh" | "en";

export const docsI18n: I18nConfig<DocsLanguage> = {
	languages: ["zh", "en"],
	defaultLanguage: "zh",
	hideLocale: "always",
	parser: "dir",
	fallbackLanguage: "zh",
};

export const languageNames: Record<DocsLanguage, string> = {
	zh: "中文",
	en: "English",
};

/** Navigation titles for pages that still use the default-language body fallback. */
export const englishPageTitles: Record<string, string> = {
	index: "Vetta Documentation",
	"getting-started/index": "Quick start",
	"getting-started/installation-and-updates": "Installation, updates, and migration",
	"getting-started/first-task": "Run your first complete task",
	"core/overview": "How Vetta workflows work",
	"core/workspaces-and-sessions": "Workspaces and sessions",
	"core/context-tools-and-permissions": "Context, tools, and permissions",
	"core/progress-results-and-recovery": "Progress, results, and recovery",
	"product/overview": "User guide overview",
	"product/models": "Configure models",
	"product/abilities": "Capabilities",
	"product/mcp": "MCP connectors",
	"product/knowledge-base": "Knowledge base",
	"product/batch-tasks": "Batch tasks",
	"product/automation": "Automation",
	"product/claw": "Vetta Claw",
	"product/im": "IM channels and Claw",
	"product/remote-control": "Remote control",
	"product/webhook": "Message notifications",
	"product/application-environment": "Application environment",
	"product/desktop-pet": "Vetta Vivi desktop pet",
	"product/settings": "Settings map",
	"examples/index": "Examples",
	"examples/review-and-fix-code": "Review and fix a code issue",
	"examples/document-to-brief": "Turn documents into a brief",
	"examples/batch-project-audit": "Audit multiple projects",
	"examples/scheduled-project-report": "Schedule a project report",
	"plugins/overview": "Plugin development overview",
	"plugins/getting-started": "Build your first plugin",
	"plugins/manifest-and-permissions": "Manifest and permissions",
	"plugins/extension-points": "Extension points",
	"plugins/capabilities": "Plugin capability reference",
	"themes/overview": "Theme development overview",
	"themes/getting-started": "Build a theme",
	"themes/module-reference": "Theme module reference",
	"developers/overview": "Choose a development path",
	"developers/sdk": "Coding Agent SDK",
	"developers/sdk-reference": "Coding Agent API reference",
	"developers/rpc": "Coding Agent RPC",
	"developers/cli-and-settings": "CLI and settings",
	"developers/architecture": "Architecture",
	"reference/security-and-data": "Security and data boundaries",
	"reference/configuration-paths": "Configuration paths",
	"reference/compatibility": "Platform and capability compatibility",
	"reference/documentation-policy": "Documentation policy",
	"reference/llms": "LLM and Agent access",
	troubleshooting: "Troubleshooting",
};

export const englishPageDescriptions: Record<string, string> = {
	index: "From your first local task to Agent workflows that are reviewable, reusable, batchable, and automatable.",
	"getting-started/index": "Install Vetta, complete the first-run flow, configure a model, and prepare a workspace for a verifiable task.",
	"getting-started/installation-and-updates": "Choose the correct build, preserve local data, and diagnose upgrades or device changes safely.",
	"getting-started/first-task": "Create a session in a real workspace, provide context, inspect execution, and verify the result.",
	"core/overview": "Build a reliable mental model for workspaces, tasks, sessions, execution, permissions, and results.",
	"core/workspaces-and-sessions": "Select the right boundary for files and tools, then use session history to continue work safely.",
	"core/context-tools-and-permissions": "Control what the Agent can read, which tools it can call, and which actions need approval.",
	"core/progress-results-and-recovery": "Inspect long-running work, verify real artifacts, and recover from partial execution.",
	"product/overview": "Choose models, capabilities, knowledge, batch tasks, automation, and integrations by the work you need to complete.",
	"product/models": "Add a preset or custom provider, verify its connection, and choose a default model.",
	"product/abilities": "Install and manage skills, scenes, MCP connectors, plugins, and capability bundles.",
	"product/mcp": "Connect external tools and data through MCP while keeping commands, hosts, and credentials bounded.",
	"product/knowledge-base": "Import, process, and retrieve long-term source material with traceable boundaries.",
	"product/batch-tasks": "Run one validated task across independent directories with controlled concurrency and recovery.",
	"product/automation": "Turn a verified task into a local scheduled run with inspectable history.",
	"product/claw": "Run controlled Agent workflows from supported messaging channels.",
	"product/im": "Configure supported messaging channels as a controlled entry point for Vetta tasks and replies.",
	"product/remote-control": "Understand the current Desktop pairing boundary, host requirements, and safe recovery path.",
	"product/webhook": "Send task and automation notifications to configured external endpoints safely.",
	"product/application-environment": "Manage the bundled Node.js and Python runtimes used by local Agent tasks.",
	"product/desktop-pet": "Configure the Vetta Vivi desktop companion and its display behavior.",
	"product/settings": "Find the main settings areas and understand which controls affect models, permissions, and data.",
	"examples/index": "Copy complete task patterns with starting state, acceptance evidence, and recovery paths.",
	"examples/review-and-fix-code": "Review a code issue, make the smallest safe change, and verify it with tests and a diff.",
	"examples/document-to-brief": "Turn a bounded set of source documents into a reviewable decision brief.",
	"examples/batch-project-audit": "Audit multiple independent projects with repeatable outputs and sampling checks.",
	"examples/scheduled-project-report": "Schedule a verified project report while retaining execution history.",
	"plugins/overview": "Understand the plugin runtime, capability surface, and trust boundary before building an extension.",
	"plugins/getting-started": "Create, build, install, and debug a minimal Vetta plugin.",
	"plugins/manifest-and-permissions": "Declare plugin identity, entry points, assets, permissions, and publishing constraints.",
	"plugins/extension-points": "Choose UI, file, message, Agent, and App Action extension points by product goal.",
	"plugins/capabilities": "Find the UI, conversation, file, browser, Agent, storage, and App Action APIs.",
	"themes/overview": "Understand the Vetta theme package model and its visual boundary.",
	"themes/getting-started": "Build, preview, and install a theme with a small, verifiable package.",
	"themes/module-reference": "Reference the public theme modules, tokens, and component contracts.",
	"developers/overview": "Select the narrowest stable entry point for plugins, themes, SDK, RPC, or CLI integration.",
	"developers/sdk": "Embed Coding Agent sessions in a TypeScript process and manage their lifecycle.",
	"developers/sdk-reference": "Find public exports for sessions, hosts, configuration, resources, extensions, and runtime services.",
	"developers/rpc": "Drive an isolated Coding Agent process over stdin/stdout NDJSON.",
	"developers/cli-and-settings": "Run tasks from scripts and understand global, project, and runtime configuration.",
	"developers/architecture": "Understand package boundaries, runtime layers, and the public integration surface.",
	"reference/security-and-data": "Understand credential, file, permission, external service, and diagnostic data boundaries.",
	"reference/configuration-paths": "Locate local configuration, session, cache, and diagnostic data without guessing private paths.",
	"reference/compatibility": "Check the support boundary for Desktop, mobile, build modes, and preview features.",
	"reference/documentation-policy": "Understand which documentation is public, versioned, generated, or intentionally omitted.",
	"reference/llms": "Use Markdown and LLM entry points to give Agents accurate, bounded documentation context.",
	troubleshooting: "Diagnose login, model, file, knowledge, MCP, plugin, batch, automation, and runtime failures.",
};

export const uiTranslations: Record<DocsLanguage, Record<string, string>> = {
	zh: {
		displayName: languageNames.zh,
		"Search(search dialog)": "搜索文档",
		"Search(search trigger)": "搜索",
		"No results found(search dialog)": "没有找到结果",
		"On this page(table of contents)": "本页内容",
		"Next Page(pagination)": "下一页",
		"Previous Page(pagination)": "上一页",
		"Open Search(search trigger)(aria-label)": "打开搜索",
		"Open Sidebar(sidebar)(aria-label)": "打开侧栏",
		"Close Sidebar(sidebar)(aria-label)": "关闭侧栏",
		"Toggle Menu(mobile menu)(aria-label)": "切换菜单",
		"Toggle Theme(theme switcher)(aria-label)": "切换主题",
		"Light(theme switcher)(aria-label)": "浅色",
		"Dark(theme switcher)(aria-label)": "深色",
		"System(theme switcher)(aria-label)": "跟随系统",
		"Last updated on(page footer)": "更新于",
		"Copy Markdown(page actions)": "复制 Markdown",
		"View as Markdown(page actions)": "查看 Markdown",
		"Open(page actions)": "打开",
		"Open in ChatGPT(page actions)": "在 ChatGPT 中打开",
		"Open in Claude(page actions)": "在 Claude 中打开",
		"No Headings(table of contents)": "本页没有标题",
		"Hide Sidebar(sidebar)": "隐藏侧栏",
		"Show Sidebar(sidebar)": "显示侧栏",
		"Collapse Sidebar(sidebar)(aria-label)": "折叠侧栏",
		"Choose a language": "选择语言",
		"Choose a language(aria-label)": "选择语言",
	},
	en: {
		displayName: languageNames.en,
		"Search(search dialog)": "Search docs",
		"Search(search trigger)": "Search",
		"No results found(search dialog)": "No results found",
		"On this page(table of contents)": "On this page",
		"Next Page(pagination)": "Next page",
		"Previous Page(pagination)": "Previous page",
		"Open Search(search trigger)(aria-label)": "Open search",
		"Open Sidebar(sidebar)(aria-label)": "Open sidebar",
		"Close Sidebar(sidebar)(aria-label)": "Close sidebar",
		"Toggle Menu(mobile menu)(aria-label)": "Toggle menu",
		"Toggle Theme(theme switcher)(aria-label)": "Toggle theme",
		"Light(theme switcher)(aria-label)": "Light",
		"Dark(theme switcher)(aria-label)": "Dark",
		"System(theme switcher)(aria-label)": "System",
		"Last updated on(page footer)": "Updated on",
		"Copy Markdown(page actions)": "Copy Markdown",
		"View as Markdown(page actions)": "View as Markdown",
		"Open(page actions)": "Open",
		"Open in ChatGPT(page actions)": "Open in ChatGPT",
		"Open in Claude(page actions)": "Open in Claude",
		"No Headings(table of contents)": "No headings",
		"Hide Sidebar(sidebar)": "Hide sidebar",
		"Show Sidebar(sidebar)": "Show sidebar",
		"Collapse Sidebar(sidebar)(aria-label)": "Collapse sidebar",
		"Choose a language": "Choose a language",
		"Choose a language(aria-label)": "Choose a language",
	},
};

export function isDocsLanguage(value: string): value is DocsLanguage {
	return docsI18n.languages.includes(value as DocsLanguage);
}

export function getI18nProvider(language: DocsLanguage): I18nProviderProps {
	return {
		locale: language,
		locales: docsI18n.languages.map((locale) => ({
			locale,
			name: languageNames[locale],
		})),
		translations: uiTranslations[language],
	};
}

export function getRequestLanguage(request: Request): DocsLanguage {
	const cookie = request.headers.get("cookie")?.match(/(?:^|;\s*)FD_LOCALE=([^;]+)/)?.[1];
	if (cookie && isDocsLanguage(cookie)) return cookie;

	const acceptLanguage = request.headers.get("accept-language")?.toLowerCase() ?? "";
	const englishIndex = acceptLanguage.search(/(?:^|,)\s*en(?:[-,;]|$)/u);
	const chineseIndex = acceptLanguage.search(/(?:^|,)\s*zh(?:[-,;]|$)/u);
	if (englishIndex !== -1 && (chineseIndex === -1 || englishIndex < chineseIndex)) return "en";
	return "zh";
}
