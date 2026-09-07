import { describe, expect, test } from "vitest";
import {
  formatPlaywrightAttachFailure,
  validatePlaywrightArguments,
} from "./ui-verification-diagnostics";

describe("UI verification diagnostics", () => {
  test("directs long Windows run-code callbacks to the file form", () => {
    expect(validatePlaywrightArguments(["run-code", "x".repeat(2_000)])).toContain("--filename");
    expect(validatePlaywrightArguments(["run-code", "--filename=C:/tmp/probe.js"])).toBeNull();
    expect(validatePlaywrightArguments(["snapshot"])).toBeNull();
  });

  test("explains the stale DevTools target attach failure", () => {
    const message = formatPlaywrightAttachFailure({
      sessionName: "vetta-dev-test",
      status: null,
      signal: "SIGTERM",
      timedOut: true,
      stdout: "<ws connected>",
      devtoolsTargetCount: 1,
    });

    expect(message).toContain("timed out");
    expect(message).toContain("close stale DevTools windows");
    expect(message).toContain("<ws connected>");
  });
});
