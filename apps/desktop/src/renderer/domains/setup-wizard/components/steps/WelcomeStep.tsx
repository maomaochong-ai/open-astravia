import { BotAvatar } from "@shared/components/BotAvatar";
import { useTranslation } from "react-i18next";

const HIGHLIGHTS = [
	{ icon: "icon-[solar--chat-round-line-linear]", key: "chat" as const },
	{ icon: "icon-[solar--magic-stick-3-linear]", key: "skills" as const },
	{ icon: "icon-[solar--widget-2-linear]", key: "automation" as const },
] as const;

export function WelcomeStep(): JSX.Element {
	const { t } = useTranslation("common");

	return (
		<div className="flex w-full flex-col items-center gap-5 text-center">
			<div className="flex items-center justify-center">
				<BotAvatar size="lg" autoplay />
			</div>
			<div>
				<h2 className="text-[20px] font-bold text-foreground">{t("setupWizard.welcome.title")}</h2>
				<p className="mt-2 text-[13px] text-muted-foreground">{t("setupWizard.welcome.subtitle")}</p>
			</div>

			<ul className="w-full space-y-2 text-left">
				{HIGHLIGHTS.map((item) => (
					<li
						key={item.key}
						className="flex items-start gap-3 rounded-xl border border-border/50 bg-card/40 px-3.5 py-3"
					>
						<span className={`${item.icon} mt-0.5 h-5 w-5 shrink-0 text-primary`} />
						<div className="min-w-0">
							<div className="text-[13px] font-medium text-foreground">
								{t(`setupWizard.welcome.highlights.${item.key}.title`)}
							</div>
							<p className="mt-0.5 text-[11px] text-muted-foreground">
								{t(`setupWizard.welcome.highlights.${item.key}.desc`)}
							</p>
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}
