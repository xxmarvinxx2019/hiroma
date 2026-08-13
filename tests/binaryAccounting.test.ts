import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateBinaryFundingPosition,
  calculateClosingLiability,
} from "../src/app/lib/binaryAccounting";

test("total reserve includes both earmarked and uncommitted funds", () => {
  const result = calculateBinaryFundingPosition({
    payableLiability: 44_850,
    uncommittedReserve: 33_000,
    earmarkedReserve: 4_900,
  });

  assert.equal(result.totalReserveHeld, 37_900);
  assert.equal(result.fundingShortfall, 6_950);
  assert.equal(result.fundingSurplus, 0);
});

test("reserve surplus is not reported as a shortfall", () => {
  const result = calculateBinaryFundingPosition({
    payableLiability: 5_000,
    uncommittedReserve: 3_000,
    earmarkedReserve: 4_000,
  });

  assert.equal(result.totalReserveHeld, 7_000);
  assert.equal(result.fundingShortfall, 0);
  assert.equal(result.fundingSurplus, 2_000);
  assert.equal(result.coverageRatio, 140);
});

test("approved amounts remain in closing liability until released", () => {
  assert.equal(
    calculateClosingLiability({
      openingLiability: 10_000,
      earned: 2_500,
      released: 1_000,
    }),
    11_500,
  );
});
