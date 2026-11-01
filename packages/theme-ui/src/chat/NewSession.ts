import type { ComponentPropsWithoutRef } from "react";

export interface NewSessionSkillItem {
	readonly alias?: string;
	readonly description: string;
	readonly name: string;
}

export interface NewSessionSkillSelection {
	readonly alias?: string;
	readonly name: string;
	readonly type?: string;
}

export type NewSessionSelection = NewSessionSkillSelection | null;

export interface NewSessionGuidingWordsGroup {
	readonly id: string;
	readonly name: string;
	readonly pageKey: number;
	readonly words: readonly string[];
}

export interface NewSessionGuidingWordsProps extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
	readonly groups: readonly NewSessionGuidingWordsGroup[];
	readonly mounted: boolean;
	readonly onPick: (word: string) => void;
}

export interface NewSessionSkillBadgeRowLabels {
	readonly scrollLeft: string;
	readonly scrollRight: string;
}

export interface NewSessionSkillBadgeRowProps extends Omit<ComponentPropsWithoutRef<"div">, "children" | "onSelect"> {
	readonly labels: NewSessionSkillBadgeRowLabels;
	readonly onSelect: (skill: NewSessionSkillItem) => void;
	readonly selected: NewSessionSelection;
	readonly skills: readonly NewSessionSkillItem[];
}

/** Hero 身份头像：单个智能体是它自己，团队是全部成员（不截断，由渲染方决定显示上限）。 */
export interface NewSessionHeroAvatar {
	readonly avatar?: string;
	readonly blueprintId?: string;
	readonly name: string;
}

/**
 * 选中的会话对象（单个智能体或团队）在 hero 上的身份展示。
 * 未选中时 host 传 null，hero 回到问候语 + 默认副标题。
 */
export interface NewSessionHeroIdentity {
	/** 团队的全部成员头像，按成员顺序；渲染方超出上限的部分应折成 “+n”。 */
	readonly avatars: readonly NewSessionHeroAvatar[];
	/** 身份切换的重放键：值变化即视为换了一个身份，主题据此重播切换动画。 */
	readonly key: string;
	readonly subtitle: string;
	readonly title: string;
}

/** 新会话页欢迎区（标题/副标题/头像）。主题可覆盖以替换装饰与布局。 */
export interface NewSessionHeroProps extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
	/** 默认实现里 BotAvatar 的 idle 手势循环；主题若不渲染头像可忽略。 */
	readonly avatarAutoplay: boolean;
	readonly greetingTitle: string;
	/** 选中的智能体/团队身份；为 null 时展示 `greetingTitle` / `subtitle` 问候语。 */
	readonly identity?: NewSessionHeroIdentity | null;
	readonly mounted: boolean;
	readonly subtitle: string;
}
