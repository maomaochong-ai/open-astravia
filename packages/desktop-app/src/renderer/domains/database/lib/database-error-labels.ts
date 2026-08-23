import type { TFunction } from "i18next";
import type { DatabaseError } from "../../../../preload/api-types/database";

/** 稳定错误码 → i18n key 映射（workspace 与查询面板共用）。 */
export const ERROR_LABEL_KEYS = {
	SQL_BLOCKED: "databaseError.sqlBlocked",
	CONNECTION_NOT_FOUND: "databaseError.notFound",
	CONNECTION_FAILED: "databaseError.connectionFailed",
	CONNECTION_EXISTS: "databaseError.connectionExists",
	INVALID_PARAMS: "databaseError.invalidParams",
	DBX_NOT_RUNNING: "databaseError.engineNotRunning",
	READ_ONLY: "databaseError.readOnly",
	PROD_WRITE_BLOCKED: "databaseError.prodWriteBlocked",
	WRITE_BLOCKED: "databaseError.writeBlocked",
	DDL_BLOCKED: "databaseError.ddlBlocked",
	TIMEOUT: "databaseError.timeout",
	UNKNOWN: "databaseError.unknown",
} as const;

/** 把抽象层抛出的 DatabaseError（或任意异常）折算成可展示文案 + 排查 detail。 */
export function formatDatabaseError(
	t: TFunction<"settings">,
	error: unknown,
): { message: string; detail: string | null } {
	if (error && typeof error === "object" && "code" in error && "detail" in error) {
		const dbError = error as DatabaseError;
		return {
			message: t(ERROR_LABEL_KEYS[dbError.code as keyof typeof ERROR_LABEL_KEYS]),
			detail: dbError.detail || null,
		};
	}
	const detail = error instanceof Error ? error.message : String(error);
	return { message: t("databaseError.unknown"), detail };
}
