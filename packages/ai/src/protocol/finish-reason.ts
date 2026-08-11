export type SuccessfulStopReason = "stop" | "length" | "toolUse";
export type FailedStopReason = "error" | "aborted";
export type StopReason = SuccessfulStopReason | FailedStopReason;
