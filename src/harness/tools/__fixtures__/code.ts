// Fixture: deliberately simple code-like content for Grep tests.
// Strings here are probed by patterns in grep.test.ts — do not
// rename the exported symbols without updating the tests.

import { something } from "./other-module";

export function benchmarkFoo(input: number): number {
  return input + 1;
}

export function benchmarkBar(): string {
  return "bar";
}

export const CONSTANT_VALUE = 42;

class HiddenClass {
  private value = 0;
}
