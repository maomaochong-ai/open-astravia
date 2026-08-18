import type { SelectedSkill } from "@shared/store/atoms";
import { SkillPromptAreaView } from "@vetta/theme-ui/chat";
import { createPortal } from "react-dom";
import { useSkillPromptAreaModel } from "../hooks/useSkillPromptAreaModel";
import { SkillPickerPanel } from "./command-panel/SkillPickerPanel";

interface SkillPromptAreaProps {
	prompt: string;
	onPromptChange: (value: string) => void;
	skill: SelectedSkill | null | undefined;
	onSkillChange: (skill: SelectedSkill | null) => void;
	placeholder?: string;
	minHeight?: number;
	className?: string;
	autoFocus?: boolean;
	/** 目标会话/项目 cwd，用于列出项目级 `<cwd>/.agents/skills` 与 `<cwd>/.vetta/skills`。 */
	cwd?: string;
}

/**
 * 批量任务 / 自动化 dialog 共用的"带技能/场景"prompt 输入区。
 */
export function SkillPromptArea(props: SkillPromptAreaProps): JSX.Element {
	const model = useSkillPromptAreaModel(props);
	const slashPortal =
		model.slashOpen && model.anchorRect
			? createPortal(
					<div
						className="pointer-events-none fixed z-[60]"
						style={{
							left: model.anchorRect.left,
							top: model.anchorRect.bottom,
							width: model.anchorRect.width,
						}}
					>
						<div className="pointer-events-auto relative">
							<SkillPickerPanel
								open={model.slashOpen}
								onClose={model.handleSlashClose}
								onSelect={model.handleSlashSelect}
								filter={model.slashFilter}
								placement="bottom"
								cwd={model.cwd}
							/>
						</div>
					</div>,
					document.body,
				)
			: null;

	return (
		<SkillPromptAreaView
			prompt={model.prompt}
			placeholder={model.placeholder}
			minHeight={model.minHeight}
			className={model.className}
			autoFocus={model.autoFocus}
			slashOpen={model.slashOpen}
			skillMissing={model.skillMissing}
			isScene={model.isScene}
			skillDisplayName={model.skillDisplayName}
			hasSkill={Boolean(model.skill)}
			anchorRect={model.anchorRect}
			textareaRef={model.textareaRef}
			cardRef={model.cardRef}
			labels={model.labels}
			slashPanel={slashPortal}
			onChange={model.onChange}
			onKeyDown={model.onKeyDown}
			onPlusClick={model.onPlusClick}
			onRemoveSkill={model.onRemoveSkill}
		/>
	);
}
