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

/** The diff to describe, degraded to a summary when it blows the budget. */
async function readDiff(root: string, scope: DiffScope): Promise<string> {
	const full = await git(root, diffArgsForScope(scope, false));
	if (full.ok && diffFitsBudget(full.stdout)) return full.stdout;

	const summary = await git(root, diffArgsForScope(scope, true));
	const head = full.ok ? full.stdout.slice(0, AI_CONTEXT_LIMITS.DIFF_BUDGET) : "";
	return [summary.stdout, head].filter((part) => part.trim().length > 0).join("\n\n");
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
