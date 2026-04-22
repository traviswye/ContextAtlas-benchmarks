// Unit-level coverage for ca-agent.ts. The real CA flow (spawn
// contextatlas, connect over stdio, dispatch tools against a live
// MCP server) is exercised by the gated integration test. This
// file pins the module's public shape and imports so refactors
// that break the CA surface fail typecheck + test rather than
// only surfacing at integration time.

import { describe, expect, it } from "vitest";
import { runCaAgent, withCaTools } from "./ca-agent.js";

describe("ca-agent public surface", () => {
  it("exports runCaAgent as a function", () => {
    expect(typeof runCaAgent).toBe("function");
  });

  it("exports withCaTools as a function", () => {
    expect(typeof withCaTools).toBe("function");
  });
});
