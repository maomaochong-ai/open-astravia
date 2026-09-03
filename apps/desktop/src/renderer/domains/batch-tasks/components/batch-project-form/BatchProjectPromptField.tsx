import { SkillPromptArea } from "@domains/conversation/components/SkillPromptArea";
import type { SelectedSkill } from "@shared/store/atoms";
import { useBatchProjectPromptFieldModel } from "../../hooks/useBatchProjectPromptFieldModel";

export function BatchProjectPromptField({
	prompt,
	promptMinHeight,
	skill,
	onPromptChange,
	onSkillChange,
}: {
	prompt: string;
	promptMinHeight: number;
	skill: SelectedSkill | null;
	onPromptChange: (prompt: string) => void;
	onSkillChange: (skill: SelectedSkill | null) => void;
}): JSX.Element {
	const model = useBatchProjectPromptFieldModel();

	return (
		<SkillPromptArea
			prompt={prompt}
			onPromptChange={onPromptChange}
			skill={skill}
			onSkillChange={onSkillChange}
			placeholder={model.placeholder}
			minHeight={promptMinHeight}
		/>
	);
}
