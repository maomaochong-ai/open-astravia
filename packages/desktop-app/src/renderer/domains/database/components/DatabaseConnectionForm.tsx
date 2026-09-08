import type { JSX } from "react";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Spin,
	Switch,
} from "@astravia/ui";
import { InputField } from "@astravia/theme-ui/settings";
import { useTranslation } from "react-i18next";
import type { DbConnectionTestResult } from "../../../../preload/api-types/database";
import { DatabaseNotice } from "./DatabaseNotice";
import { DatabaseDetail } from "./DatabaseDetail";
import { DatabaseSectionLabel } from "./DatabaseSectionLabel";
import { DatabaseTypePicker } from "./DatabaseTypePicker";
import { getDatabaseTypeMeta } from "../lib/database-type-catalog";
import type { DatabaseConnectionFormState, DatabaseFormFieldKey } from "../hooks/useDatabaseWorkspaceModel";

export interface DatabaseConnectionFormProps {
	readonly busy: boolean;
	readonly error: string | null;
	readonly errorDetail: string | null;
	readonly form: DatabaseConnectionFormState;
	readonly onChange: (field: DatabaseFormFieldKey, value: string | boolean) => void;
	readonly onCancel: () => void;
	readonly onPickFile: () => void;
	readonly onSave: () => void;
	readonly onTest: () => void;
	readonly open: boolean;
	readonly testResult: DbConnectionTestResult | null;
	readonly testing: boolean;
}

function FieldLabel({ children }: { children: string }): JSX.Element {
	return <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">{children}</div>;
}

/** 表单分组标题：仅小标题，不画分隔线（与分区标题组件同源）。 */
function FormSectionLabel({ label }: { label: string }): JSX.Element {
	return <DatabaseSectionLabel className="col-span-2 mt-1 first:mt-0">{label}</DatabaseSectionLabel>;
}

export function DatabaseConnectionForm({
	busy,
	error,
	errorDetail,
	form,
	onChange,
	onCancel,
	onPickFile,
	onSave,
	onTest,
	open,
	testResult,
	testing,
}: DatabaseConnectionFormProps): JSX.Element {
	const { t } = useTranslation("settings");
	const meta = getDatabaseTypeMeta(form.dbType);

	return (
		<Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
			{/* B2.6-W 反馈 2：紧凑化 —— 限高 + 中间内容区内部滚动 + footer 粘底，矮屏不被遮挡。 */}
			<DialogContent className="max-w-[min(38rem,calc(100%-2rem))] max-h-[min(42rem,calc(100dvh-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
				<DialogHeader className="shrink-0">
					<DialogTitle>{t("databaseAddConnection")}</DialogTitle>
					<DialogDescription>{t("databaseEngineNote")}</DialogDescription>
				</DialogHeader>

				<div className="grid min-h-0 grid-cols-2 gap-3 overflow-y-auto pr-1">
					<FormSectionLabel label={t("databaseSectionConnectionInfo")} />
					<div className="col-span-2">
						<FieldLabel>{t("databaseDbType")}</FieldLabel>
						<DatabaseTypePicker value={form.dbType} onChange={(value) => onChange("dbType", value)} />
					</div>

					<div className="col-span-2">
						<FieldLabel>{t("databaseConnectionName")}</FieldLabel>
						<InputField
							value={form.name}
							onChange={(value) => onChange("name", value)}
							placeholder={t("databaseConnectionName")}
						/>
					</div>

					{meta.fileBased ? (
						<div className="col-span-2">
							<FieldLabel>{t("databaseHostFile")}</FieldLabel>
							<div className="flex gap-2">
								<InputField
									value={form.host}
									onChange={(value) => onChange("host", value)}
									placeholder={meta.hostPlaceholder}
								/>
								<Button type="button" variant="outline" size="sm" onClick={onPickFile}>
										<span className="icon-[lucide--folder-open] h-3.5 w-3.5" />
									{t("databaseBrowse")}
								</Button>
							</div>
						</div>
					) : (
						<>
							<div>
								<FieldLabel>{t("databaseHost")}</FieldLabel>
								<InputField
									value={form.host}
									onChange={(value) => onChange("host", value)}
									placeholder={meta.hostPlaceholder}
								/>
							</div>
							<div>
								<FieldLabel>{t("databasePort")}</FieldLabel>
								<InputField
									value={form.port}
									onChange={(value) => onChange("port", value)}
									placeholder={meta.defaultPort || t("databasePort")}
								/>
							</div>
						</>
					)}

					<div>
						<FieldLabel>{t("databaseDatabase")}</FieldLabel>
						<InputField
							value={form.database}
							onChange={(value) => onChange("database", value)}
							placeholder={t("databaseDatabase")}
						/>
					</div>

					{!meta.fileBased && (
						<div className="col-span-2 flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
							<label className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-foreground">
												<span className="icon-[lucide--shield-lock] h-3.5 w-3.5 text-muted-foreground" />
								{t("databaseSsl")}
							</label>
							<Switch checked={form.ssl} onCheckedChange={(value) => onChange("ssl", value)} />
						</div>
					)}

					{/* W4-② 环境标记：生产连接默认禁止写操作，需在连接详情中显式授权。 */}
					<div className="col-span-2 flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
						<label className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-foreground">
												<span className="icon-[lucide--layers] h-3.5 w-3.5 text-muted-foreground" />
							{t("databaseEnvironment")}
						</label>
						<Select value={form.env} onValueChange={(value) => onChange("env", value === "prod" ? "prod" : "dev")}>
							<SelectTrigger size="sm" className="w-[132px]">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="dev">{t("databaseEnvDev")}</SelectItem>
								<SelectItem value="prod">{t("databaseEnvProd")}</SelectItem>
							</SelectContent>
						</Select>
					</div>
					{form.env === "prod" ? (
						<div className="col-span-2">
											<DatabaseNotice tone="info" icon="icon-[lucide--shield-alert]" title={t("databaseEnvProdNotice")} />
						</div>
					) : null}

					<FormSectionLabel label={t("databaseSectionCredentials")} />

					<div>
						<FieldLabel>{t("databaseUsername")}</FieldLabel>
						<InputField
							value={form.username}
							onChange={(value) => onChange("username", value)}
							placeholder={t("databaseUsername")}
						/>
					</div>
					<div>
						<FieldLabel>{t("databasePassword")}</FieldLabel>
						<InputField
							type="password"
							value={form.password}
							onChange={(value) => onChange("password", value)}
							placeholder="••••••••"
						/>
					</div>
					{testResult ? <DatabaseNotice tone="success" title={t("databaseTestSuccess")} /> : null}

					{error ? (
						<DatabaseNotice tone="error" title={error}>
							{errorDetail ? (
								<DatabaseDetail>{errorDetail}</DatabaseDetail>
							) : null}
						</DatabaseNotice>
					) : null}
				</div>

				<DialogFooter className="shrink-0">

					<Button variant="ghost" size="sm" onClick={onCancel} disabled={busy || testing}>
						{t("databaseCancel")}
					</Button>
					<Button variant="outline" size="sm" onClick={onTest} disabled={busy || testing}>
						{testing ? <Spin size="sm" /> : <span className="icon-[lucide--plug-zap] h-3.5 w-3.5" />}
						{testing ? t("databaseTesting") : t("databaseTest")}
					</Button>
					<Button variant="primary" size="sm" onClick={onSave} disabled={busy || testing}>
						{busy ? <Spin size="sm" /> : <span className="icon-[lucide--save] h-3.5 w-3.5" />}
						{t("databaseSave")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
