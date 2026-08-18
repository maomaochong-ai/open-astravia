import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@vetta/ui";
import { useTranslation } from "react-i18next";

/** 本地导入通道：skill 压缩包、插件 zip、手动 MCP。 */
export function AddAbilityMenu({
	importing,
	onImportSkill,
	onImportPlugin,
	onAddRepository,
	onAddMcp,
}: {
	importing: boolean;
	onImportSkill: () => void;
	onImportPlugin: () => void;
	onAddRepository: () => void;
	onAddMcp: () => void;
}): JSX.Element {
	const { t } = useTranslation("abilities");

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button type="button" variant="outline">
					<span className="icon-[solar--add-circle-linear] h-3.5 w-3.5" />
					<span>{t("add.trigger")}</span>
					<span className="icon-[solar--alt-arrow-down-linear] h-3 w-3 text-muted-foreground/60" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-72">
				<DropdownMenuLabel>{t("add.title")}</DropdownMenuLabel>
				<DropdownMenuItem disabled={importing} onSelect={onImportSkill} className="items-start gap-2.5 py-2.5">
					<span
						className={`mt-0.5 h-4 w-4 shrink-0 ${
							importing ? "icon-[solar--refresh-linear] animate-spin" : "icon-[solar--archive-up-linear]"
						}`}
					/>
					<span className="min-w-0">
						<span className="block text-[13px] font-medium">{t("add.importSkill")}</span>
						<span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground/70">
							{t("add.importSkillHint")}
						</span>
					</span>
				</DropdownMenuItem>
				<DropdownMenuItem disabled={importing} onSelect={onImportPlugin} className="items-start gap-2.5 py-2.5">
					<span
						className={`mt-0.5 h-4 w-4 shrink-0 ${
							importing ? "icon-[solar--refresh-linear] animate-spin" : "icon-[solar--widget-2-linear]"
						}`}
					/>
					<span className="min-w-0">
						<span className="block text-[13px] font-medium">{t("add.importPlugin")}</span>
						<span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground/70">
							{t("add.importPluginHint")}
						</span>
					</span>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={onAddRepository} className="items-start gap-2.5 py-2.5">
					<span className="icon-[solar--cloud-download-linear] mt-0.5 h-4 w-4 shrink-0" />
					<span className="min-w-0">
						<span className="block text-[13px] font-medium">{t("add.externalRepository")}</span>
						<span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground/70">
							{t("add.externalRepositoryHint")}
						</span>
					</span>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={onAddMcp} className="items-start gap-2.5 py-2.5">
					<span className="icon-[solar--server-square-cloud-linear] mt-0.5 h-4 w-4 shrink-0" />
					<span className="min-w-0">
						<span className="block text-[13px] font-medium">{t("add.addMcp")}</span>
						<span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground/70">
							{t("add.addMcpHint")}
						</span>
					</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
