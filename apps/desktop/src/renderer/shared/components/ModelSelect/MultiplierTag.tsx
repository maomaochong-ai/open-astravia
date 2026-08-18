import { useTranslation } from "react-i18next";
import {
	fmtMultiplier,
	MultiplierTag as ThemeMultiplierTag,
} from "@vetta/theme-ui/shared";
import type { ModelOption } from "./useModelOptions";

export { fmtMultiplier } from "@vetta/theme-ui/shared";

/** Desktop adapter: i18n for free/multiplier labels. */
export function MultiplierTag({
	multiplier,
}: {
	multiplier: ModelOption["multiplier"];
}): JSX.Element | null {
	const { t } = useTranslation("common");
	if (!multiplier) return null;
	const { input, output } = multiplier;
	const text =
		input === 0 && output === 0
			? t("modelSelect.free")
			: t("modelSelect.multiplier", { value: fmtMultiplier(input) });
	return <ThemeMultiplierTag text={text} />;
}
