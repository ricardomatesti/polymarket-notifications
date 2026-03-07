const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  getParisDate,
  isWithinParisWindow,
  extractTodayMaxInfo,
  diffRegionState,
} = require("../script.js");

const fixturePath = path.join(__dirname, "..", "fixtures", "weather_sample.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

test("extractTodayMaxInfo computes max temp and count per day", () => {
  const result = extractTodayMaxInfo(fixture);
  assert.deepEqual(result, {
    Saturday: { maxTemp: 14, maxTempCount: 3 },
    Sunday: { maxTemp: 10, maxTempCount: 2 },
  });
});

test("extractTodayMaxInfo ignores days beyond first two", () => {
  const threeDays = {
    dayOfWeek: ["Saturday", "Saturday", "Sunday", "Sunday", "Monday", "Monday"],
    temperature: [10, 11, 12, 12, 99, 99],
  };
  const result = extractTodayMaxInfo(threeDays);
  assert.deepEqual(result, {
    Saturday: { maxTemp: 11, maxTempCount: 1 },
    Sunday: { maxTemp: 12, maxTempCount: 2 },
  });
});

test("diffRegionState marks first run of day as notify", () => {
  const current = {
    Saturday: { maxTemp: 12, maxTempCount: 2 },
  };
  const diff = diffRegionState(null, current);

  assert.equal(diff.length, 1);
  assert.equal(diff[0].shouldNotify, true);
  assert.equal(diff[0].reason, "first_run_of_day");
  assert.equal(diff[0].day, "Saturday");
});

test("diffRegionState skips notify when unchanged", () => {
  const previous = { Saturday: { maxTemp: 12, maxTempCount: 2 } };
  const current = { Saturday: { maxTemp: 12, maxTempCount: 2 } };
  const diff = diffRegionState(previous, current);

  assert.equal(diff.length, 1);
  assert.equal(diff[0].shouldNotify, false);
  assert.equal(diff[0].reason, "no_change");
});

test("diffRegionState marks notify when max changes", () => {
  const previous = { Saturday: { maxTemp: 12, maxTempCount: 2 } };
  const current = { Saturday: { maxTemp: 13, maxTempCount: 2 } };
  const diff = diffRegionState(previous, current);

  assert.equal(diff.length, 1);
  assert.equal(diff[0].shouldNotify, true);
  assert.equal(diff[0].reason, "new_max");
});

test("diffRegionState marks notify when count changes", () => {
  const previous = { Saturday: { maxTemp: 12, maxTempCount: 2 } };
  const current = { Saturday: { maxTemp: 12, maxTempCount: 3 } };
  const diff = diffRegionState(previous, current);

  assert.equal(diff.length, 1);
  assert.equal(diff[0].shouldNotify, true);
  assert.equal(diff[0].reason, "change_in_freq");
});

test("Paris time window gate behaves as expected", () => {
  const inWindow = new Date("2026-03-07T09:15:00+01:00");
  const outWindow = new Date("2026-03-07T19:00:00+01:00");

  assert.equal(isWithinParisWindow(inWindow), true);
  assert.equal(isWithinParisWindow(outWindow), false);
});

test("getParisDate returns YYYY-MM-DD in Paris timezone", () => {
  const date = new Date("2026-03-07T23:30:00Z");
  assert.equal(getParisDate(date), "2026-03-08");
});
