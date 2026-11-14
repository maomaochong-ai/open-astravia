import { SkillPromptArea } from "@domains/conversation/components/SkillPromptArea";
import { RendererMarkdownContent } from "@shared/components/RendererMarkdownContent";
import type { SelectedSkill } from "@shared/store/atoms";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from "@astravia-org/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface AutomationPromptFieldProps {
	readonly prompt: string;
	readonly skills: readonly SelectedSkill[];
	readonly placeholder: string;
	readonly cwd?: string;
	readonly dialogMinHeight: number;
	readonly onChange: (prompt: string, skills: SelectedSkill[]) => void;
}

/** 任务正文：Markdown 预览（高度随内容），点「编辑」在弹窗里改。 */
export function AutomationPromptField({
	prompt,
	skills,
	placeholder,
	cwd,
	dialogMinHeight,
	onChange,
}: AutomationPromptFieldProps): JSX.Element {
	const { t } = useTranslation("automation");
	const [open, setOpen] = useState(false);
	const empty = prompt.trim() === "";
	const skill = skills[0] ?? null;

	return (
		<>
			<div className="rounded-xl border border-border bg-card px-4 py-3">
				<div className="mb-2 flex items-center gap-2">
					{skill ? (
						<span className="flex h-6 items-center rounded-md bg-primary/10 px-2 text-[12px] text-primary">
							{skill.alias || skill.name}
						</span>
					) : null}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="ml-auto bg-muted text-[12px] text-foreground hover:bg-accent"
						onClick={() => setOpen(true)}
					>
						<span className="icon-[mdi--pencil-outline] h-3.5 w-3.5" />
						{t("form.promptEdit")}
					</Button>
				</div>
				{empty ? (
					<button
						type="button"
						onClick={() => setOpen(true)}
						className="block w-full py-2 text-left text-[13px] text-muted-foreground/60"
					>
						{placeholder}
					</button>
				) : (
					<div className="text-[13px] leading-relaxed [&_.markdown-body]:p-0">
						<RendererMarkdownContent text={prompt} cwd={cwd} />
					</div>
				)}
			</div>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="sm:max-w-[640px]">
					<DialogHeader className="text-left">
						<DialogTitle className="text-base font-semibold">{t("form.promptEditTitle")}</DialogTitle>
					</DialogHeader>
					<SkillPromptArea
						prompt={prompt}
						onPromptChange={(body) => onChange(body, [...skills])}
						skills={skills}
						onSkillsChange={(next) => onChange(prompt, next)}
						maxSkills={1}
						placeholder={placeholder}
						minHeight={dialogMinHeight}
						cwd={cwd}
						autoFocus
					/>
					<div className="flex justify-end">
						<Button type="button" variant="primary" onClick={() => setOpen(false)}>
							{t("form.promptDone")}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
