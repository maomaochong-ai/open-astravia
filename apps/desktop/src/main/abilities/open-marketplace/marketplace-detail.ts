import type { OpenMarketplaceDetail } from "../../../preload/api-types/abilities.js";

function mergeDefinedFields<T extends object>(base: T, override: T): T {
	return {
		...base,
		...Object.fromEntries(Object.entries(override).filter(([, value]) => value !== undefined)),
	};
}

/** 包内展示按字段覆盖目录元信息；同语言的正文不能抹掉目录中的名称和简介。 */
export function mergeMarketplaceDetail(
	catalog: OpenMarketplaceDetail,
	presentation: OpenMarketplaceDetail,
): OpenMarketplaceDetail {
	const { i18n: catalogLocales, ...catalogBase } = catalog;
	const { i18n: presentationLocales, ...presentationBase } = presentation;
	const locales = new Set([...Object.keys(catalogLocales ?? {}), ...Object.keys(presentationLocales ?? {})]);
	return {
		...mergeDefinedFields(catalogBase, presentationBase),
		i18n: Object.fromEntries(
			Array.from(locales, (locale) => [
				locale,
				mergeDefinedFields(catalogLocales?.[locale] ?? {}, presentationLocales?.[locale] ?? {}),
			]),
		),
	};
}
