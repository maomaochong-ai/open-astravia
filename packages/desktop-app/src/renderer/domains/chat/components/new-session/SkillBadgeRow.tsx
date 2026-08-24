import { useThemeComponent } from "@astravia/theme-sdk";
import {
	DefaultSkillBadgeRow,
	type NewSessionSelection,
	type NewSessionSkillItem,
	type NewSessionSkillBadgeRowProps,
} from "@astravia/theme-ui/chat";
import { useTranslation } from "react-i18next";

interface SkillBadgeRowProps {
	onSelect: (skill: NewSessionSkillItem) => void;
	selected: NewSessionSelection;
	skills: readonly NewSessionSkillItem[];
}

/**
 * 新会话页技能徽章行的 i18n 连接入口：补齐 labels 后交给 theme-ui
 * `chat.newSessionSkillBadgeRow` 槽位（默认 DefaultSkillBadgeRow）。
 */
export function SkillBadgeRow({ onSelect, selected, skills }: SkillBadgeRowProps): JSX.Element {
	const { t } = useTranslation("chat");
	const ThemedRow = useThemeComponent("chat.newSessionSkillBadgeRow", DefaultSkillBadgeRow);

	const labels: NewSessionSkillBadgeRowProps["labels"] = {
		scrollLeft: t("newSession.skillBadges.scrollLeft"),
		scrollRight: t("newSession.skillBadges.scrollRight"),
	};

	return <ThemedRow labels={labels} onSelect={onSelect} selected={selected} skills={skills} />;
}
