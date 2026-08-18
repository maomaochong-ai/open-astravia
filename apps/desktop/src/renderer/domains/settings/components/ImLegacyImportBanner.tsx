import type { ImLegacyDetection } from "@preload/api";
import { ImLegacyImportBannerView } from "@vetta/theme-ui/settings";
import { useTranslation } from "react-i18next";

export function ImLegacyImportBanner({
	legacy,
	importing,
	onImport,
	onSkip,
}: {
	legacy: ImLegacyDetection;
	importing: boolean;
	onImport: () => Promise<void>;
	onSkip: () => void;
}): JSX.Element {
	const { t } = useTranslation("settings");
	const path = legacy.credentialsPath ?? legacy.configPath ?? legacy.statePath;
	const appId = legacy.parsed?.feishu?.appId;

	return (
		<ImLegacyImportBannerView
			title={t("legacyTitle")}
			pathLine={t("legacyPath", { path })}
			appIdSuffix={appId ? `（App ID: ${appId}）` : null}
			importing={importing}
			importDisabled={importing || !appId}
			importLabel={importing ? t("importing") : t("importToNew")}
			skipLabel={t("skip")}
			onImport={() => void onImport()}
			onSkip={onSkip}
		/>
	);
}
