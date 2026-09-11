/**
 * 能力图标只在来源边界保留字符串表示；进入产品读模型前，所有来源都使用这里的
 * 显式策略收敛优先级，避免页面、Skill 列表和命令区各自拼 fallback。
 */
export function resolvePluginPresentationIcon(input: {
	readonly packageIcon?: string;
	readonly manifestIcon?: string;
	readonly catalogIcon?: string;
}): string | undefined {
	return input.packageIcon || input.manifestIcon || input.catalogIcon || undefined;
}

export function resolveProvidedSkillPresentationIcon(input: {
	readonly skillIcon?: string;
	readonly providerIcon?: string;
	readonly catalogIcon?: string;
	readonly builtinIcon?: string;
}): string | undefined {
	return input.skillIcon || input.providerIcon || input.catalogIcon || input.builtinIcon || undefined;
}
