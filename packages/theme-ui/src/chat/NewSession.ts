import type { ComponentPropsWithoutRef } from "react";

export interface NewSessionSkillItem {
	readonly alias?: string;
	readonly description: string;
	readonly name: string;
}

export interface NewSessionSceneItem {
	readonly alias?: string;
	readonly description: string;
	readonly downloadCount?: number;
	readonly name: string;
	readonly state: "active" | "disabled" | "uninstalled";
	readonly version?: string;
}

export interface NewSessionSkillSelection {
	readonly alias?: string;
	readonly name: string;
	readonly type?: string;
}

export type NewSessionSelection = NewSessionSkillSelection | null;

export type NewSessionSceneActionState = "idle" | "loading" | "error";

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

export interface NewSessionSceneCarouselLabels {
	readonly installPrompt: string;
	readonly next: string;
	readonly previous: string;
}

export interface NewSessionSceneCarouselProps extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
	readonly actions: Readonly<Record<string, NewSessionSceneActionState>>;
	readonly labels: NewSessionSceneCarouselLabels;
	readonly onSceneClick: (scene: NewSessionSceneItem) => void;
	readonly scenes: readonly NewSessionSceneItem[];
	readonly selected: NewSessionSelection;
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

/** 新会话页欢迎区（标题/副标题/头像/场景轮播）。主题可覆盖以替换装饰与布局。 */
export interface NewSessionHeroProps extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
	/** 默认实现里 BotAvatar 的 idle 手势循环；主题若不渲染头像可忽略。 */
	readonly avatarAutoplay: boolean;
	readonly greetingTitle: string;
	/** 选中的智能体/团队身份；为 null 时展示 `greetingTitle` / `subtitle` 问候语。 */
	readonly identity?: NewSessionHeroIdentity | null;
	readonly mounted: boolean;
	readonly onSceneClick: (scene: NewSessionSceneItem) => void;
	/**
	 * 资源尚未返回时预留场景轮播高度，避免 scenes 从空变为有数据时把输入栏顶下去。
	 * 加载完成且确实无场景时由 host 置 false，槽位收回。
	 */
	readonly reserveSceneSlot?: boolean;
	readonly sceneActions: Readonly<Record<string, NewSessionSceneActionState>>;
	/** 场景轮播文案（host 已 i18n）；主题若复用场景轮播应透传。 */
	readonly sceneLabels: NewSessionSceneCarouselLabels;
	readonly scenes: readonly NewSessionSceneItem[];
	readonly selected: NewSessionSelection;
	readonly subtitle: string;
}
