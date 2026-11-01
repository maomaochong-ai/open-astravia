/**
 * skill 来源 → i18n key。命令面板与 dialog 选择器共用。
 *
 * 必须保留字面量类型：chat 命名空间的 `t()` 是强类型的，`Record<string, string>`
 * 会把 key 退化成 string 而被拒。
 */
const SOURCE_LABEL_KEYS = {
	builtin: "slashPanel.sourceLabels.builtin",
	plugin: "slashPanel.sourceLabels.plugin",
	market: "slashPanel.sourceLabels.market",
	user: "slashPanel.sourceLabels.user",
	project: "slashPanel.sourceLabels.project",
	path: "slashPanel.sourceLabels.path",
	"agents-user": "slashPanel.sourceLabels.agentsUser",
	"agents-project": "slashPanel.sourceLabels.agentsProject",
} as const;

export type SkillSourceLabelKey = (typeof SOURCE_LABEL_KEYS)[keyof typeof SOURCE_LABEL_KEYS];

/** 按 source 取标签；未知来源返回 null 由调用方回退原值。 */
export function skillSourceLabelKey(source: string): SkillSourceLabelKey | null {
	return source in SOURCE_LABEL_KEYS ? SOURCE_LABEL_KEYS[source as keyof typeof SOURCE_LABEL_KEYS] : null;
}
