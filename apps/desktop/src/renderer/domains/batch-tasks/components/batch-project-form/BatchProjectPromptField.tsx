import { SkillPromptArea } from "@domains/conversation/components/SkillPromptArea";
import type { SelectedSkill } from "@shared/store/atoms";
import { useBatchProjectPromptFieldModel } from "../../hooks/useBatchProjectPromptFieldModel";

export function BatchProjectPromptField({
	prompt,
	promptMinHeight,
	skills,
	onPromptChange,
	onSkillsChange,
}: {
	prompt: string;
	promptMinHeight: number;
	skills: readonly SelectedSkill[];
	onPromptChange: (prompt: string) => void;
	onSkillsChange: (skills: SelectedSkill[]) => void;
}): JSX.Element {
	const model = useBatchProjectPromptFieldModel();

	return (
		<SkillPromptArea
			prompt={prompt}
			onPromptChange={onPromptChange}
			skills={skills}
			onSkillsChange={onSkillsChange}
			placeholder={model.placeholder}
			minHeight={promptMinHeight}
		/>
	);
}
