import prisma from "@/app/lib/prisma";

export type BinaryBreakdownRow = {
  package_name: string;
  pair_value: number;
  quantity: number;
  amount: number;
  details: string;
  data_quality: "exact" | "mixed" | "reconstructed";
};

type PairRow = {
  package_name: string;
  pair_value: number;
  completed: number;
  payable: number;
  cap_flashout: number;
  inactive_flashout: number;
  payable_amount: number;
  flashout_amount: number;
  reconstructed: number;
};
type MoneyRow = {
  package_name: string;
  pair_value: number;
  quantity: number;
  amount: number;
  legacy_count: number;
  total_count: number;
};
type ReserveRow = {
  package_name: string;
  pair_value: number;
  registrations: number;
  upgrades: number;
  amount: number;
};
type ReserveExitRow = {
  package_name: string;
  pair_value: number;
  quantity: number;
  amount: number;
};

const n = (value: unknown) => Number(value || 0) || 0;
const key = (name: string, pairValue: number) => `${name}\u0000${pairValue}`;

const moneyRows = (rows: MoneyRow[], detail: (row: MoneyRow) => string) =>
  rows.map((row) => ({
    package_name: row.package_name,
    pair_value: n(row.pair_value),
    quantity: n(row.quantity),
    amount: n(row.amount),
    details: detail(row),
    data_quality:
      n(row.legacy_count) === 0
        ? ("exact" as const)
        : n(row.legacy_count) < n(row.total_count)
          ? ("mixed" as const)
          : ("reconstructed" as const),
  }));

export async function loadBinaryCommissionBreakdowns(from: Date, to: Date) {
  const [pairs, earned, approved, paid, flashout, allocated, releasedReserve, flashoutReserve] =
    await Promise.all([
      prisma.$queryRaw<PairRow[]>`
        SELECT e.package_name_snapshot package_name,
               e.pair_value_snapshot::float pair_value,
               SUM(e.completed_pairs)::int completed,
               SUM(e.payable_pairs)::int payable,
               SUM(e.cap_flashout_pairs)::int cap_flashout,
               SUM(e.inactive_flashout_pairs)::int inactive_flashout,
               SUM(e.payable_amount)::float payable_amount,
               SUM(e.flashout_amount)::float flashout_amount,
               COUNT(*) FILTER (WHERE e.package_snapshot_source <> 'exact_event')::int reconstructed
        FROM binary_pair_events e
        WHERE e.created_at >= ${from} AND e.created_at <= ${to}
        GROUP BY e.package_name_snapshot, e.pair_value_snapshot
        ORDER BY e.package_name_snapshot, e.pair_value_snapshot
      `,
      prisma.$queryRaw<MoneyRow[]>`
        SELECT COALESCE(e.package_name_snapshot,p.name,'Unknown') package_name,
               COALESCE(e.pair_value_snapshot,p.pairing_bonus_value * 0.5,0)::float pair_value,
               COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN e.payable_pairs
                    WHEN p.pairing_bonus_value > 0 THEN FLOOR(c.points / p.pairing_bonus_value)
                    ELSE 0 END),0)::int quantity,
               SUM(c.amount)::float amount,
               COUNT(*) FILTER (WHERE e.id IS NULL)::int legacy_count,
               COUNT(*)::int total_count
        FROM commissions c
        LEFT JOIN binary_pair_events e ON e.normal_commission_id=c.id
        LEFT JOIN reseller_profiles r ON r.user_id=c.user_id
        LEFT JOIN packages p ON p.id=r.package_id
        WHERE c.type='binary_pairing' AND c.is_pair_overflow=false
          AND c.created_at >= ${from} AND c.created_at <= ${to}
        GROUP BY COALESCE(e.package_name_snapshot,p.name,'Unknown'),
                 COALESCE(e.pair_value_snapshot,p.pairing_bonus_value * 0.5,0)
        ORDER BY 1,2
      `,
      prisma.$queryRaw<MoneyRow[]>`
        SELECT COALESCE(e.package_name_snapshot,pkg.name,'Unknown') package_name,
               COALESCE(e.pair_value_snapshot,pkg.pairing_bonus_value * 0.5,0)::float pair_value,
               COUNT(DISTINCT p.id)::int quantity, SUM(pc.amount)::float amount,
               COUNT(*) FILTER (WHERE e.id IS NULL)::int legacy_count,
               COUNT(*)::int total_count
        FROM binary_payout_consumptions pc
        JOIN payouts p ON p.id=pc.payout_id
        JOIN binary_payable_lots lot ON lot.id=pc.payable_lot_id
        JOIN commissions c ON c.id=lot.commission_id
        LEFT JOIN binary_pair_events e ON e.normal_commission_id=c.id
        LEFT JOIN reseller_profiles r ON r.user_id=c.user_id
        LEFT JOIN packages pkg ON pkg.id=r.package_id
        WHERE p.status='approved'
          AND COALESCE(p.processed_at,p.requested_at) <= ${to}
        GROUP BY COALESCE(e.package_name_snapshot,pkg.name,'Unknown'),
                 COALESCE(e.pair_value_snapshot,pkg.pairing_bonus_value * 0.5,0)
        ORDER BY 1,2
      `,
      prisma.$queryRaw<MoneyRow[]>`
        SELECT COALESCE(e.package_name_snapshot,pkg.name,'Unknown') package_name,
               COALESCE(e.pair_value_snapshot,pkg.pairing_bonus_value * 0.5,0)::float pair_value,
               COUNT(DISTINCT p.id)::int quantity, SUM(pc.amount)::float amount,
               COUNT(*) FILTER (WHERE e.id IS NULL)::int legacy_count,
               COUNT(*)::int total_count
        FROM binary_payout_consumptions pc
        JOIN payouts p ON p.id=pc.payout_id
        JOIN binary_payable_lots lot ON lot.id=pc.payable_lot_id
        JOIN commissions c ON c.id=lot.commission_id
        LEFT JOIN binary_pair_events e ON e.normal_commission_id=c.id
        LEFT JOIN reseller_profiles r ON r.user_id=c.user_id
        LEFT JOIN packages pkg ON pkg.id=r.package_id
        WHERE p.status='released'
          AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at) >= ${from}
          AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at) <= ${to}
        GROUP BY COALESCE(e.package_name_snapshot,pkg.name,'Unknown'),
                 COALESCE(e.pair_value_snapshot,pkg.pairing_bonus_value * 0.5,0)
        ORDER BY 1,2
      `,
      prisma.$queryRaw<MoneyRow[]>`
        SELECT COALESCE(e.package_name_snapshot,'Legacy / Unknown') package_name,
               COALESCE(e.pair_value_snapshot,0)::float pair_value,
               COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN e.cap_flashout_pairs + e.inactive_flashout_pairs
                    ELSE 0 END),0)::int quantity,
               SUM(c.amount)::float amount,
               COUNT(*) FILTER (WHERE e.id IS NULL)::int legacy_count,
               COUNT(*)::int total_count
        FROM commissions c
        LEFT JOIN binary_pair_events e ON e.flashout_commission_id=c.id
        WHERE c.type='binary_pairing' AND c.is_pair_overflow=true
          AND c.created_at >= ${from} AND c.created_at <= ${to}
        GROUP BY COALESCE(e.package_name_snapshot,'Legacy / Unknown'),
                 COALESCE(e.pair_value_snapshot,0)
        ORDER BY 1,2
      `,
      prisma.$queryRaw<ReserveRow[]>`
        SELECT COALESCE(rf.package_name_snapshot,uf.to_package_name_snapshot,p.name,'Unknown') package_name,
               COALESCE(rf.binary_points_per_pair * rf.binary_point_peso_rate,p.pairing_bonus_value * 0.5,0)::float pair_value,
               COUNT(*) FILTER (WHERE lot.registration_financial_id IS NOT NULL)::int registrations,
               COUNT(*) FILTER (WHERE lot.upgrade_financial_id IS NOT NULL)::int upgrades,
               SUM(lot.original_amount)::float amount
        FROM binary_reserve_lots lot
        LEFT JOIN registration_financials rf ON rf.id=lot.registration_financial_id
        LEFT JOIN upgrade_financials uf ON uf.id=lot.upgrade_financial_id
        LEFT JOIN packages p ON p.id=COALESCE(rf.package_id,uf.to_package_id::text)
        WHERE lot.allocated_at >= ${from} AND lot.allocated_at <= ${to}
        GROUP BY COALESCE(rf.package_name_snapshot,uf.to_package_name_snapshot,p.name,'Unknown'),
                 COALESCE(rf.binary_points_per_pair * rf.binary_point_peso_rate,p.pairing_bonus_value * 0.5,0)
        ORDER BY 1,2
      `,
      prisma.$queryRaw<ReserveExitRow[]>`
        WITH funded AS (
          SELECT rc.commission_id, SUM(rc.amount)::numeric funded_amount
          FROM binary_reserve_consumptions rc JOIN commissions c ON c.id=rc.commission_id
          WHERE rc.is_unfunded=false AND c.is_pair_overflow=false GROUP BY rc.commission_id
        ), before_period AS (
          SELECT lot.commission_id, SUM(pc.amount)::numeric amount
          FROM binary_payout_consumptions pc JOIN binary_payable_lots lot ON lot.id=pc.payable_lot_id
          JOIN payouts p ON p.id=pc.payout_id
          WHERE p.status='released' AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at) < ${from}
          GROUP BY lot.commission_id
        ), through_period AS (
          SELECT lot.commission_id, SUM(pc.amount)::numeric amount
          FROM binary_payout_consumptions pc JOIN binary_payable_lots lot ON lot.id=pc.payable_lot_id
          JOIN payouts p ON p.id=pc.payout_id
          WHERE p.status='released' AND COALESCE(p.released_at,p.payout_date,p.processed_at,p.requested_at) <= ${to}
          GROUP BY lot.commission_id
        )
        SELECT COALESCE(e.package_name_snapshot,p.name,'Unknown') package_name,
               COALESCE(e.pair_value_snapshot,p.pairing_bonus_value * 0.5,0)::float pair_value,
               COUNT(*) FILTER (WHERE LEAST(f.funded_amount,COALESCE(t.amount,0)) > LEAST(f.funded_amount,COALESCE(b.amount,0)))::int quantity,
               SUM(LEAST(f.funded_amount,COALESCE(t.amount,0)) - LEAST(f.funded_amount,COALESCE(b.amount,0)))::float amount
        FROM funded f JOIN commissions c ON c.id=f.commission_id
        LEFT JOIN before_period b ON b.commission_id=f.commission_id
        LEFT JOIN through_period t ON t.commission_id=f.commission_id
        LEFT JOIN binary_pair_events e ON e.normal_commission_id=c.id
        LEFT JOIN reseller_profiles r ON r.user_id=c.user_id LEFT JOIN packages p ON p.id=r.package_id
        GROUP BY COALESCE(e.package_name_snapshot,p.name,'Unknown'),
                 COALESCE(e.pair_value_snapshot,p.pairing_bonus_value * 0.5,0)
        HAVING SUM(LEAST(f.funded_amount,COALESCE(t.amount,0)) - LEAST(f.funded_amount,COALESCE(b.amount,0))) > 0
      `,
      prisma.$queryRaw<ReserveExitRow[]>`
        SELECT COALESCE(e.package_name_snapshot,p.name,'Unknown') package_name,
               COALESCE(e.pair_value_snapshot,p.pairing_bonus_value * 0.5,0)::float pair_value,
               COUNT(DISTINCT c.id)::int quantity, SUM(rc.amount)::float amount
        FROM binary_reserve_consumptions rc JOIN commissions c ON c.id=rc.commission_id
        LEFT JOIN binary_pair_events e ON e.flashout_commission_id=c.id
        LEFT JOIN reseller_profiles r ON r.user_id=e.recipient_user_id LEFT JOIN packages p ON p.id=r.package_id
        WHERE rc.is_unfunded=false AND c.is_pair_overflow=true
          AND rc.consumed_at >= ${from} AND rc.consumed_at <= ${to}
        GROUP BY COALESCE(e.package_name_snapshot,p.name,'Unknown'),
                 COALESCE(e.pair_value_snapshot,p.pairing_bonus_value * 0.5,0)
      `,
    ]);

  const earnedBreakdown = moneyRows(
    earned,
    (row) => `${n(row.quantity)} payable pair${n(row.quantity) === 1 ? "" : "s"}`,
  );
  const approvedBreakdown = moneyRows(
    approved,
    (row) => `${n(row.quantity)} approved payout request${n(row.quantity) === 1 ? "" : "s"}`,
  );
  const paidBreakdown = moneyRows(
    paid,
    (row) => `${n(row.quantity)} released payout request${n(row.quantity) === 1 ? "" : "s"}`,
  );
  const flashoutBreakdown = moneyRows(
    flashout,
    (row) => `${n(row.quantity)} binary pair${n(row.quantity) === 1 ? "" : "s"} retained by Hiroma`,
  );
  const exactPairMap = new Map(
    pairs.map((row) => [key(row.package_name, n(row.pair_value)), row]),
  );
  const pairMap = new Map<
    string,
    BinaryBreakdownRow & { payable_pairs: number; flashout_pairs: number }
  >();
  const addPairCategory = (
    row: BinaryBreakdownRow,
    category: "payable_pairs" | "flashout_pairs",
  ) => {
    const rowKey = key(row.package_name, row.pair_value);
    const current = pairMap.get(rowKey) || {
      package_name: row.package_name,
      pair_value: row.pair_value,
      quantity: 0,
      amount: 0,
      details: "",
      data_quality: row.data_quality,
      payable_pairs: 0,
      flashout_pairs: 0,
    };
    current.quantity += row.quantity;
    current.amount += row.amount;
    current[category] += row.quantity;
    if (current.data_quality !== row.data_quality) current.data_quality = "mixed";
    pairMap.set(rowKey, current);
  };
  earnedBreakdown.forEach((row) => addPairCategory(row, "payable_pairs"));
  flashoutBreakdown.forEach((row) => addPairCategory(row, "flashout_pairs"));
  const pairBreakdown: BinaryBreakdownRow[] = [...pairMap.values()].map((row) => {
    const exact = exactPairMap.get(key(row.package_name, row.pair_value));
    return {
      package_name: row.package_name,
      pair_value: row.pair_value,
      quantity: row.quantity,
      amount: row.amount,
      details: exact
        ? `${row.payable_pairs} payable / ${n(exact.cap_flashout)} cap flashout / ${n(exact.inactive_flashout)} inactive flashout`
        : `${row.payable_pairs} payable / ${row.flashout_pairs} flashout (historical reconstruction)`,
      data_quality: exact && n(exact.reconstructed) === 0 ? row.data_quality : "reconstructed",
    };
  });
  const reserveAllocatedBreakdown: BinaryBreakdownRow[] = allocated.map((row) => ({
    package_name: row.package_name,
    pair_value: n(row.pair_value),
    quantity: n(row.registrations) + n(row.upgrades),
    amount: n(row.amount),
    details: `${n(row.registrations)} registration${n(row.registrations) === 1 ? "" : "s"} · ${n(row.upgrades)} upgrade${n(row.upgrades) === 1 ? "" : "s"}`,
    data_quality: "exact",
  }));

  const liabilityMap = new Map<string, BinaryBreakdownRow>();
  for (const row of earnedBreakdown)
    liabilityMap.set(key(row.package_name, row.pair_value), {
      ...row,
      details: `Earned ${row.amount.toFixed(2)} · released 0.00`,
    });
  for (const row of paidBreakdown) {
    const rowKey = key(row.package_name, row.pair_value);
    const current = liabilityMap.get(rowKey) || {
      package_name: row.package_name,
      pair_value: row.pair_value,
      quantity: 0,
      amount: 0,
      details: "Earned 0.00 · released 0.00",
      data_quality: row.data_quality,
    };
    const earnedAmount = current.amount;
    current.amount -= row.amount;
    current.quantity += row.quantity;
    current.details = `Earned ${earnedAmount.toFixed(2)} · released ${row.amount.toFixed(2)}`;
    if (current.data_quality !== row.data_quality) current.data_quality = "mixed";
    liabilityMap.set(rowKey, current);
  }

  type ReserveMovement = {
    package_name: string;
    pair_value: number;
    quantity: number;
    allocated: number;
    released: number;
    flashout: number;
    data_quality: "exact" | "reconstructed";
  };
  const reserveMap = new Map<string, ReserveMovement>();
  for (const row of reserveAllocatedBreakdown)
    reserveMap.set(key(row.package_name, row.pair_value), {
      package_name: row.package_name,
      pair_value: row.pair_value,
      quantity: row.quantity,
      allocated: row.amount,
      released: 0,
      flashout: 0,
      data_quality: "exact",
    });
  const applyReserveExit = (row: ReserveExitRow, kind: "released" | "flashout") => {
    const rowKey = key(row.package_name, n(row.pair_value));
    const current = reserveMap.get(rowKey) || {
      package_name: row.package_name,
      pair_value: n(row.pair_value),
      quantity: 0,
      allocated: 0,
      released: 0,
      flashout: 0,
      data_quality: "reconstructed" as const,
    };
    current.quantity += n(row.quantity);
    current[kind] += n(row.amount);
    reserveMap.set(rowKey, current);
  };
  releasedReserve.forEach((row) => applyReserveExit(row, "released"));
  flashoutReserve.forEach((row) => applyReserveExit(row, "flashout"));

  return {
    pairs: pairBreakdown,
    earned: earnedBreakdown,
    approved: approvedBreakdown,
    paid: paidBreakdown,
    liability: [...liabilityMap.values()],
    flashout: flashoutBreakdown,
    reserve_allocated: reserveAllocatedBreakdown,
    reserve_movement: [...reserveMap.values()].map((row) => ({
      package_name: row.package_name,
      pair_value: row.pair_value,
      quantity: row.quantity,
      amount: row.allocated - row.released - row.flashout,
      details: `Allocated ${row.allocated.toFixed(2)} · released ${row.released.toFixed(2)} · flashout ${row.flashout.toFixed(2)}`,
      data_quality: row.data_quality,
    })),
  };
}
