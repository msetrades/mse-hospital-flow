import assert from "node:assert/strict";
import test from "node:test";
import { projectUnits, type Unit } from "../src/lib/flow.ts";

const units: Unit[] = [
  { name: "Medical", beds: 20, occupied: 16, admissions: 8, discharges: 4, staffed: 18, los: 48 },
  { name: "Surgery", beds: 12, occupied: 6, admissions: 2, discharges: 4, staffed: 5, los: 36 },
];

test("occupancy projection scales daily flows to the requested horizon and limits staffed capacity", () => {
  const result = projectUnits(units, 12);
  assert.equal(result[0].name, "Medical");
  assert.equal(result[0].forecast, 18);
  assert.equal(result[0].capacity, 18);
  assert.equal(result[0].spillover, 0);
  assert.equal(result[1].forecast, 5);
  assert.equal(result[1].capacity, 5);
});

test("unmanned units rank as infinite pressure and invalid horizons are rejected", () => {
  const result = projectUnits([{ ...units[0], staffed: 0 }], 24);
  assert.equal(result[0].pressure, Number.POSITIVE_INFINITY);
  assert.equal(result[0].spillover, 20);
  assert.throws(() => projectUnits(units, 169), /between 0 and 168/);
});
