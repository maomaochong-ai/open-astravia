import type { AbilityCatalogSource } from "../types";

export type AbilitySourceNameKey = "detail.source.builtin" | "detail.source.local" | "detail.source.server";

export type AbilitySourcePresentation =
	| { nameKey: AbilitySourceNameKey; repository?: never }
	| { name: string; repository: string; nameKey?: never };

/** 将目录来源转换为详情页可展示的数据，GitHub 名称直接来自来源配置。 */
export function resolveAbilitySourcePresentation(source: AbilityCatalogSource): AbilitySourcePresentation {
	switch (source.kind) {
		case "builtin":
			return { nameKey: "detail.source.builtin" };
		case "local":
			return { nameKey: "detail.source.local" };
		case "server":
			return { nameKey: "detail.source.server" };
		case "github":
			return {
				name: source.name,
				repository: source.repository,
			};
	}
}
