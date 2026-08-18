import { useSkillsPageModel } from "../hooks/useSkillsPageModel";
import { SkillsPageView } from "./SkillsPageView";

export function ScenesPage(): JSX.Element {
	return <SkillsPageView model={useSkillsPageModel()} />;
}
