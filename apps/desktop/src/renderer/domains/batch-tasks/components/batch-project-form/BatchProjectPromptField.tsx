import { SkillPromptArea } from "@domains/chat/components/SkillPromptArea";
import type { SelectedSkill } from "@shared/store/atoms";
import { BatchProjectPromptFieldView } from "@vetta/theme-ui/batch-tasks";
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
		<BatchProjectPromptFieldView>
			<SkillPromptArea
				prompt={prompt}
				onPromptChange={onPromptChange}
				skill={skill}
				onSkillChange={onSkillChange}
				placeholder={model.placeholder}
				minHeight={promptMinHeight}
			/>
		</BatchProjectPromptFieldView>
	);
}
