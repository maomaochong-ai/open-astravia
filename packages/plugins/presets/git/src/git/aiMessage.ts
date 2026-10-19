import { AI_CONTEXT_LIMITS, condenseRules, diffArgsForScope, diffFitsBudget, type DiffScope } from "./aiContext";
import { getAiApi, getFsApi, getGitCommand } from "./runtime";

/** Project documents that may state commit-message rules, in priority order. */
const RULES_FILES = ["AGENTS.md", "CLAUDE.md"] as const;

const SYSTEM_PROMPT = [
	"You write git commit messages.",
	"Output ONLY the commit message itself: no preamble, no explanation, no code fences, no quotes around it.",
	"The first line is the subject. If a body adds information the subject cannot carry, separate it with a blank line.",
	"Describe why the change was made and its effect, not a restatement of the diff.",
	"When the project's own rules and the user's template disagree, the project's rules win.",
].join("\n");

/**
 * Strip the scaffolding models add around a commit message.
 *
 * The system prompt asks for a bare message, but that instruction is not
 * reliable, and a leaked "Here is the commit message:" line or a ```-fence would
 * end up in the repository's history verbatim. Belt and braces.
 */
export function cleanGeneratedMessage(raw: string): string {
	let text = raw.trim();

	// A whole-answer code fence, with or without a language tag.
	const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(text);
	if (fenced) text = (fenced[1] ?? "").trim();

	// A single leading lead-in line ("Here is …:", "好的，这是提交信息：").
	const lines = text.split("\n");
	// 中文没有词边界，\b 在「好的」后面不成立，所以两套前缀分开匹配。
	const leadIn = /^(?:(?:here'?s?|here is|sure|okay|ok)\b|(?:好的|以下是|这是))[^\n]*[:：]\s*$/i;
	if (lines.length > 1 && leadIn.test((lines[0] ?? "").trim())) {
		lines.shift();
		text = lines.join("\n").trim();
	}

	// Wrapping quotes around the entire message.
	if (text.length > 1 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("“") && text.endsWith("”")))) {
		text = text.slice(1, -1).trim();
	}

	return text.replace(/\n{3,}/g, "\n\n").trim();
}

async function git(root: string, args: string[]): Promise<{ stdout: string; ok: boolean }> {
	const res = await getGitCommand().run("git", args, { cwd: root });
	return { stdout: res.stdout, ok: res.exitCode === 0 };
}

/** Read the project's rules documents, condensed to fit the prompt. */
async function readProjectRules(root: string): Promise<string> {
	const parts: string[] = [];
	for (const name of RULES_FILES) {
		try {
			const result = await getFsApi().readFile(`${root}/${name}`);
			if (result.encoding !== "utf8" || result.content.trim().length === 0) continue;
			parts.push(`--- ${name} ---\n${condenseRules(result.content)}`);
		} catch {
			// Absent file: nothing to contribute.
		}
	}
	return parts.join("\n\n");
}

/**
 * Diff of the files git already tracks.
 *
 * `diff HEAD` is the one range that covers index and worktree together, but a
 * repository without any commit has no HEAD to resolve and the command fails
 * outright. There the two ranges have to be read separately, otherwise a brand
 * new project reports "nothing to describe" while its first files sit unstaged.
 */
async function readTrackedDiff(root: string, scope: DiffScope, summary: boolean): Promise<string> {
	const primary = await git(root, diffArgsForScope(scope, summary));
	if (primary.ok) return primary.stdout;
	if (scope !== "worktree") return "";

	const [cached, worktree] = await Promise.all([
		git(root, summary ? ["diff", "--cached", "--stat"] : ["diff", "--cached"]),
		git(root, summary ? ["diff", "--stat"] : ["diff"]),
	]);
	return [cached.stdout, worktree.stdout].filter((part) => part.trim().length > 0).join("\n\n");
}

interface NewFiles {
	/** Hunks synthesized for the files whose body fits the per-file budget. */
	body: string;
	paths: string[];
}

/**
 * Files git has never seen appear in no `git diff`, yet pressing the commit
 * button stages every one of them — so a message built from the diff alone
 * describes a change set that is missing its new files. Their content is
 * synthesized here rather than read through `diff --no-index`: that needs a
 * platform-specific null device, while the host fs API gives the same bytes
 * everywhere.
 *
 * Only meaningful for the worktree scope; a non-empty index means the commit
 * records the index alone.
 */
async function readNewFiles(root: string): Promise<NewFiles> {
	const listing = await git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
	if (!listing.ok) return { body: "", paths: [] };

	const paths = listing.stdout.split("\0").filter(Boolean).sort();
	const blocks: string[] = [];
	let used = 0;
	for (const path of paths.slice(0, AI_CONTEXT_LIMITS.NEW_FILE_LIMIT)) {
		if (used >= AI_CONTEXT_LIMITS.DIFF_BUDGET) break;
		let content: string;
		try {
			const file = await getFsApi().readFile(`${root}/${path}`);
			content = file.encoding === "utf8" ? file.content : `[binary file: ${file.encoding}]`;
		} catch {
			// Unreadable (permissions, a dangling symlink): the path list still tells
			// the model the file is part of the change.
			continue;
		}
		const clipped = content.slice(0, AI_CONTEXT_LIMITS.NEW_FILE_BUDGET);
		const lines = clipped.split("\n").map((line) => `+${line}`);
		if (content.length > clipped.length) lines.push("+… (truncated)");
		const block = ["--- /dev/null", `+++ b/${path}`, ...lines].join("\n");
		blocks.push(block);
		used += block.length;
	}
	return { body: blocks.join("\n\n"), paths };
}

/** The diff to describe, degraded to a summary when it blows the budget. */
export async function readDiff(root: string, scope: DiffScope): Promise<string> {
	const [tracked, newFiles] = await Promise.all([
		readTrackedDiff(root, scope, false),
		scope === "worktree" ? readNewFiles(root) : Promise.resolve<NewFiles>({ body: "", paths: [] }),
	]);
	const full = [tracked, newFiles.body].filter((part) => part.trim().length > 0).join("\n\n");
	if (diffFitsBudget(full)) return full;

	const summary = await readTrackedDiff(root, scope, true);
	// The new-file bodies are what got cut; their paths still have to survive.
	const newPathList = newFiles.paths.length > 0 ? `new files:\n${newFiles.paths.map((path) => `  ${path}`).join("\n")}` : "";
	return [summary, tracked.slice(0, AI_CONTEXT_LIMITS.DIFF_BUDGET), newPathList]
		.filter((part) => part.trim().length > 0)
		.join("\n\n");
}

/** Recent subjects, so generated messages match the repository's existing style. */
async function readRecentLog(root: string): Promise<string> {
	const res = await git(root, ["log", `-${AI_CONTEXT_LIMITS.LOG_COUNT}`, "--oneline", "--no-decorate"]);
	return res.ok ? res.stdout.trim() : "";
}

export interface GenerateOptions {
	root: string;
	scope: DiffScope;
	/** The user's personal template from plugin settings (may be empty). */
	template: string;
	modelKey?: string;
	signal?: AbortSignal;
	onDelta?: (text: string) => void;
}

/**
 * Generate a commit message with the host's model, without creating a
 * conversation: `ctx.ai` goes straight to inference and never touches the
 * session store, so nothing appears in the session list.
 */
export async function generateCommitMessage(options: GenerateOptions): Promise<string> {
	const [rules, diff, log] = await Promise.all([
		readProjectRules(options.root),
		readDiff(options.root, options.scope),
		readRecentLog(options.root),
	]);

	if (diff.trim().length === 0) throw new Error("empty-diff");

	// Both rule sources are handed over together, with the priority stated, rather
	// than us guessing whether the project document covers commit messages at all
	// — a wrong guess would silently drop the user's own preferences.
	const sections = [
		rules && `# Project rules (highest priority)\n${rules}`,
		options.template.trim() && `# User template (lower priority)\n${options.template.trim()}`,
		log && `# Recent commits in this repository\n${log}`,
		`# Changes to describe\n${diff}`,
	].filter(Boolean);

	const result = await getAiApi().stream(
		{
			modelKey: options.modelKey,
			systemPrompt: SYSTEM_PROMPT,
			prompt: sections.join("\n\n"),
			temperature: 0.2,
		},
		{
			signal: options.signal,
			onTextDelta: (event) => options.onDelta?.(event.text),
		},
	);

	return cleanGeneratedMessage(result.text);
}
