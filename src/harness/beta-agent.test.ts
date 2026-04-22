// Unit-level surface coverage for beta-agent.ts. The real flow
// (spawn claude, parse stream-json, dispatch tools, clean up)
// lives in claude-code-driver.ts and is exercised there plus in
// the env-gated beta-agent.integration.test.ts. This file pins
// the exported shape so refactors that break the Beta dispatch
// surface fail at typecheck + test time rather than only
// surfacing at integration time.

import { describe, expect, it } from "vitest";
import { runBetaAgent } from "./beta-agent.js";

describe("beta-agent public surface", () => {
  it("exports runBetaAgent as a function", () => {
    expect(typeof runBetaAgent).toBe("function");
  });
});
