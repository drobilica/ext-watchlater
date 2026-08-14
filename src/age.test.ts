import assert from "node:assert/strict";
import test from "node:test";
import { parseAgeDays } from "./age.ts";

test("relative ages", () => {
  assert.equal(parseAgeDays("3 years ago"), 3 * 365);
  assert.equal(parseAgeDays("8 months ago"), 8 * 30);
  assert.equal(parseAgeDays("2 weeks ago"), 14);
  assert.equal(parseAgeDays("yesterday"), 1);
  assert.equal(parseAgeDays("Streamed 2 years ago"), 2 * 365);
});

test("ignores views-only strings", () => {
  assert.equal(parseAgeDays("1.2M views"), null);
  assert.equal(parseAgeDays("4:32"), null);
});

test("reads age inside a mixed metadata line", () => {
  assert.equal(parseAgeDays("1.2M views • 3 years ago"), 3 * 365);
});
