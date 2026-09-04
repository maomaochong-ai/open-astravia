import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Type, type Static } from "@sinclair/typebox";
import { definePlugin } from "@vetta-org/plugin-sdk";
import "./style.css";
import {
	DEMO_TOGGLE_KEYS,
	type DemoToggleKey,
	getDemoSettingsStore,
	initDemoSettings,
} from "./demo-settings";
import { NOVEL_WRITE_CHAPTER_FILE_TOOL_DESCRIPTION } from "./tool-description";

const writeChapterSchema = Type.Object({
	path: Type.String({
		description: "Target file path for the chapter draft. Use an absolute path or a path inside the current project.",
	}),
	title: Type.String({
		description: "Chapter title to write at the top of the file.",
	}),
	content: Type.String({
		description: "Chapter prose or outline content.",
	}),
});

type WriteChapterInput = Static<typeof writeChapterSchema>;

function settingEnabled(key: DemoToggleKey): boolean {
	return getDemoSettingsStore().current()[key];
}

/**
 * 插件自绘的配置区。宿主不再提供设置页配置槽，开关就放在插件自己的面板里（ADR-0105）。
 */
function DemoSettingsPanel() {
	const store = getDemoSettingsStore();
	const settings = useSyncExternalStore(store.subscribe, () => store.current());
	useEffect(() => {
		void store.load();
	}, [store]);
	return (
		<div className="mb-[12px] rounded-[8px] border border-[color-mix(in_srgb,var(--border)_70%,transparent)] px-[9px] py-[8px]">
			<p className="mb-[6px] text-[12px] font-semibold text-[var(--foreground)]">Plugin settings</p>
			<label className="mb-[8px] flex flex-col gap-[4px] text-[12px] text-[var(--muted-foreground)]">
				<span>Fiction style</span>
				<input
					className="h-[26px] rounded-[6px] border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-transparent px-[7px] text-[12px] text-[var(--foreground)] outline-none"
					value={settings.fictionStyle}
					onChange={(event) => void store.update({ fictionStyle: event.target.value })}
				/>
			</label>
			<ul className="m-0 list-none space-y-[4px] p-0">
				{DEMO_TOGGLE_KEYS.map((key) => (
					<li key={key}>
						<label className="flex cursor-pointer items-center gap-[6px] text-[12px] text-[var(--muted-foreground)]">
							<input
								type="checkbox"
								checked={settings[key]}
								onChange={(event) => void store.update({ [key]: event.target.checked })}
							/>
							<span>{key}</span>
						</label>
					</li>
				))}
			</ul>
		</div>
	);
}

function DemoGlobalSlot() {
	const [open, setOpen] = useState(true);
	const [count, setCount] = useState(0);
	const timestamp = useMemo(() => new Date().toLocaleTimeString(), []);
	const agentExamples = [
		"Dynamic prompt provider: fiction-system-prompt",
		"Skill path: agent/skills/fiction-outline",
		"Tool policy: deny doc_to_pdf",
		"JS tool: novel_write_chapter_file",
		"Continuation: one fiction next-step prompt per session",
		"File API: api.fs.writeFile(...)",
	];

	if (!open) {
		return (
			<button
				type="button"
				className="fixed right-[16px] bottom-[16px] z-[100] cursor-pointer rounded-[8px] border border-transparent bg-[var(--primary)] px-[11px] py-[7px] font-[var(--font-sans)] text-[13px] font-semibold text-[var(--primary-foreground)] shadow-[var(--shadow-md)] hover:opacity-90"
				onClick={() => setOpen(true)}
			>
				Plugin Demo
			</button>
		);
	}

	return (
		<section
			className="fixed right-[16px] bottom-[16px] z-[100] w-[min(320px,calc(100vw-32px))] rounded-[12px] border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-[color-mix(in_srgb,var(--popover)_96%,transparent)] p-[14px] font-[var(--font-sans)] text-[var(--popover-foreground)] shadow-[var(--shadow-lg)]"
			aria-label="Global slot demo plugin"
		>
			<div className="flex items-start justify-between gap-[12px]">
				<div>
					<p className="mb-[4px] text-[11px] font-bold tracking-[0.08em] text-[var(--primary)] uppercase">
						Plugin
					</p>
					<h2 className="text-[15px] font-bold text-[var(--foreground)]">Global Slot Demo</h2>
				</div>
				<button
					type="button"
					className="h-[26px] w-[26px] cursor-pointer rounded-[8px] border border-transparent bg-[var(--accent)] text-[13px] leading-none font-semibold text-[var(--foreground)] hover:opacity-90"
					onClick={() => setOpen(false)}
					aria-label="Hide plugin demo"
				>
					x
				</button>
			</div>
			<p className="mt-[10px] mb-[12px] text-[13px] leading-[1.5] text-[var(--muted-foreground)]">
				Rendered by an external plugin at {timestamp}. This demo also declares agent prompt, skill, and tool
				policy contributions in plugin.json.
			</p>
			<div className="mb-[12px] rounded-[8px] border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-[color-mix(in_srgb,var(--muted)_55%,transparent)] px-[9px] py-[8px]">
				<p className="mb-[6px] text-[12px] font-semibold text-[var(--foreground)]">Agent contribution demo</p>
				<ul className="m-0 list-none space-y-[4px] p-0 text-[12px] leading-[1.35] text-[var(--muted-foreground)]">
					{agentExamples.map((item) => (
						<li key={item} className="flex gap-[6px]">
							<span className="text-[var(--primary)]">-</span>
							<span>{item}</span>
						</li>
					))}
				</ul>
			</div>
			<DemoSettingsPanel />
			<div className="flex items-center justify-between gap-[10px]">
				<span className="rounded-full bg-[color-mix(in_srgb,var(--accent)_75%,transparent)] px-[8px] py-[3px] text-[12px] text-[var(--muted-foreground)]">
					Clicks: {count}
				</span>
				<button
					type="button"
					className="cursor-pointer rounded-[8px] border border-transparent bg-[var(--primary)] px-[10px] py-[6px] text-[13px] font-semibold text-[var(--primary-foreground)] hover:opacity-90"
					onClick={() => setCount((value) => value + 1)}
				>
					Increment
				</button>
			</div>
		</section>
	);
}

export default definePlugin({
	activate(ctx) {
		// 配置是插件自己的：面板读写，Agent handler 同步读同一份内存值。
		void initDemoSettings(ctx).load();
		ctx.ui.registerGlobalSlot({
			id: "demo-panel",
			component: DemoGlobalSlot,
		});
		ctx.agent.registerTool<WriteChapterInput>({
			id: "write-chapter-file",
			name: "novel_write_chapter_file",
			label: "Write Chapter",
			description: NOVEL_WRITE_CHAPTER_FILE_TOOL_DESCRIPTION,
			parameters: writeChapterSchema,
			timeoutMs: 30_000,
			scope_use: ["conversation", "cli"],
			handler: async ({ trigger, host, actions }) => {
				const input = trigger.input;
				const body = `# ${input.title}\n\n${input.content.trim()}\n`;
				await host.fs.writeFile(input.path, body);
				actions.systemPrompt.replaceBlock("plugin.global-slot-demo.last-written-chapter", {
					priority: 860,
					content: `The plugin most recently wrote the chapter "${input.title}" to ${input.path}.`,
				});
				if (settingEnabled("continuationDemoEnabled")) {
					actions.continuation.request({
						text: `Verify that the chapter "${input.title}" was written successfully, then summarize the saved artifact.`,
						idempotencyKey: `written-chapter:${input.path}:${input.title}`,
					});
				}
				return {
					text: `Wrote chapter "${input.title}" to ${input.path}.`,
					path: input.path,
					title: input.title,
				};
			},
		});
		ctx.agent.registerSystemPromptProvider({
			id: "fiction-system-prompt",
			timeoutMs: 3000,
			context: { systemPrompt: "full", conversation: "messages" },
			handler: ({ session, model, conversation, runtime, systemPrompt, actions }) => {
				const operations = [];
				const blockId = "plugin.global-slot-demo.fiction";
				const style = getDemoSettingsStore().current().fictionStyle;
				if (settingEnabled("promptAddEnabled")) {
					operations.push({
						type: "addBlock" as const,
						block: {
							id: blockId,
							priority: 850,
							content: [
								"# Dynamic Fiction Guidance",
								style,
								`Current scenario: ${session.scenario}.`,
								`Current model: ${model.provider}/${model.id}.`,
								`Conversation messages available to this provider: ${conversation.messageCount}.`,
								`Active tools: ${runtime.activeToolNames.join(", ") || "none"}.`,
								`Current prompt blocks: ${systemPrompt?.current.blocks?.length ?? 0}.`,
								`Current rendered prompt length: ${systemPrompt?.current.rendered?.length ?? 0}.`,
							].join("\n\n"),
						},
					});
				}
				if (settingEnabled("promptReplaceEnabled")) {
					operations.push({
						type: "replaceBlock" as const,
						blockId,
						block: {
							priority: 840,
							content: `# Concise Fiction Guidance\n\n${style}\n\nProduce one concrete story artifact at a time.`,
						},
					});
				}
				if (settingEnabled("promptUpdateEnabled")) {
					operations.push({
						type: "updateBlock" as const,
						blockId,
						patch: {
							priority: 830,
							content: `# Continuity-First Fiction Guidance\n\n${style}\n\nPreserve names, chronology, setting rules, and unresolved hooks.`,
						},
					});
				}
				if (settingEnabled("promptDisableEnabled")) {
					operations.push({ type: "setBlockEnabled" as const, blockId, enabled: false });
				}
				if (settingEnabled("promptRemoveEnabled")) {
					operations.push({ type: "removeBlock" as const, blockId });
				}
				if (settingEnabled("disableWriteChapterTool")) {
					actions.tools.disable("novel_write_chapter_file");
				}
				return operations;
			},
		});
		ctx.agent.registerContinuationProvider({
			id: "fiction-next-step",
			timeoutMs: 3000,
			handler: ({ session, actions }) => {
				if (!settingEnabled("continuationDemoEnabled")) {
					return null;
				}
				actions.systemPrompt.replaceBlock("plugin.global-slot-demo.continuation", {
					priority: 870,
					content: "The current run was requested by the demo continuation provider.",
				});
				return {
					text:
						"Before stopping, briefly suggest the single most useful next fiction-writing step based on the current conversation. Do not perform the step unless the user asks.",
					idempotencyKey: `fiction-next-step:${session.id}`,
				};
			},
		});
	},
});
