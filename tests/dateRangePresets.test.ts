import assert from "node:assert/strict";
import test from "node:test";
import {
  getDateRangePreset,
  getManilaToday,
} from "../src/app/lib/dateRangePresets";

test("Manila today always uses the date input format", () => {
  assert.match(getManilaToday(), /^\d{4}-\d{2}-\d{2}$/);
});

test("quick ranges have valid inclusive boundaries", () => {
  for (const preset of [
    "today",
    "yesterday",
    "last_7_days",
    "last_30_days",
    "this_month",
    "last_month",
    "this_year",
    "all_time",
  ] as const) {
    const range = getDateRangePreset(preset);
    assert.match(range.from, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(range.to, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(range.from <= range.to);
  }
});

test("standard preset menu keeps Custom range last", async () => {
  const { datePresetOptions } = await import(
    "../src/app/lib/dateRangePresets"
  );
  assert.equal(datePresetOptions.at(-1)?.value, "custom");
});
