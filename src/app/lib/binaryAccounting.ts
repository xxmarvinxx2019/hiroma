export type BinaryFundingInputs = {
  payableLiability: number;
  uncommittedReserve: number;
  earmarkedReserve: number;
};

export function calculateBinaryFundingPosition({
  payableLiability,
  uncommittedReserve,
  earmarkedReserve,
}: BinaryFundingInputs) {
  const liability = Math.max(0, payableLiability);
  const uncommitted = Math.max(0, uncommittedReserve);
  const earmarked = Math.max(0, earmarkedReserve);
  const totalReserveHeld = uncommitted + earmarked;
  const fundingShortfall = Math.max(liability - totalReserveHeld, 0);
  const fundingSurplus = Math.max(totalReserveHeld - liability, 0);
  const coverageRatio =
    liability === 0 ? 100 : (totalReserveHeld / liability) * 100;

  return {
    payableLiability: liability,
    uncommittedReserve: uncommitted,
    earmarkedReserve: earmarked,
    totalReserveHeld,
    fundingShortfall,
    fundingSurplus,
    coverageRatio,
  };
}

export function calculateClosingLiability({
  openingLiability,
  earned,
  released,
}: {
  openingLiability: number;
  earned: number;
  released: number;
}) {
  return Math.max(0, openingLiability + earned - released);
}
