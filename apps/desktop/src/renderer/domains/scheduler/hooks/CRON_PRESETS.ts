/**
 * Cron expression presets — kept for backward compatibility reference.
 * The new SchedulePicker provides a visual interface instead.
 */
export const CRON_PRESETS = [
	{ label: "每5分钟", value: "*/5 * * * *" },
	{ label: "每15分钟", value: "*/15 * * * *" },
	{ label: "每30分钟", value: "*/30 * * * *" },
	{ label: "每小时", value: "0 * * * *" },
	{ label: "每天上午9点", value: "0 9 * * *" },
	{ label: "每天下午6点", value: "0 18 * * *" },
	{ label: "每周一上午9点", value: "0 9 * * 1" },
	{ label: "每月1日上午9点", value: "0 9 1 * *" },
] as const;
