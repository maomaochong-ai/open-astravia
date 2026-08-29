import { localeConfig, type DocsLanguage } from "./i18n";

const formatterOptions: Intl.DateTimeFormatOptions = {
	year: "numeric",
	month: "long",
	day: "numeric",
	timeZone: "Asia/Shanghai",
};

export function formatDocsDate(iso?: string, locale: DocsLanguage = "zh"): string | undefined {
	if (!iso) return undefined;

	const parsed = new Date(iso);
	if (Number.isNaN(parsed.getTime())) return undefined;

	return new Intl.DateTimeFormat(localeConfig[locale].intlLocale, formatterOptions).format(parsed);
}
