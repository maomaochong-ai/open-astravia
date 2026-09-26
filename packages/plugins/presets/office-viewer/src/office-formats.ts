export const SPREADSHEET_EXTENSIONS = ["xls", "xlsx", "xlsm", "xlsb", "ods", "csv", "tsv"] as const;

/** Only formats this plugin can actually preview. Do not claim unsupported extensions. */
export const OFFICE_EXTENSIONS = ["pdf", "docx", "pptx", ...SPREADSHEET_EXTENSIONS];

export function isSpreadsheetExtension(extension: string): boolean {
	return SPREADSHEET_EXTENSIONS.some((candidate) => candidate === extension);
}
