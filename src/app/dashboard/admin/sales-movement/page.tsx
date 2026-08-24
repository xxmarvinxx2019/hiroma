"use client";

import { useEffect, useState } from "react";
import {
  datePresetOptions,
  getDateRangePreset,
  type DateRangePreset,
} from "@/app/lib/dateRangePresets";

type Breakdown = {
  key: string;
  label: string;
  orders: number;
  units: number;
  gross_sales: number;
  cost: number;
  gross_profit: number;
  collected: number;
  receivable: number;
};
type Movement = {
  id: string;
  order_id: string;
  order_number: string | null;
  event_at: string;
  status: string;
  payment_status: string | null;
  order_type: string;
  seller_name: string;
  seller_username: string;
  seller_level: string;
  buyer_name: string;
  buyer_username: string;
  buyer_level: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  gross_sales: number;
  cost: number;
  gross_profit: number;
  cost_quality: string;
};
type DistributorOption = {
  id: string;
  full_name: string;
  username: string;
  role: string;
  distributor_profile: {
    dist_level: string;
    coverage_area: string;
    region_code: string | null;
    region_name: string | null;
    province_code: string | null;
    province_name: string | null;
    city_muni_code: string | null;
    city_muni_name: string | null;
  } | null;
};
type Trend = {
  period: string;
  gross_sales: number;
  cost: number;
  gross_profit: number;
  purchases: number;
  units_sold: number;
  units_purchased: number;
};
type AreaRow = {
  key: string;
  region_code: string | null;
  region_name: string | null;
  province_code: string | null;
  province_name: string | null;
  city_muni_code: string | null;
  city_muni_name: string | null;
  sellers: number;
  buyers: number;
  orders: number;
  units: number;
  gross_sales: number;
  cost: number;
  gross_profit: number;
  collected: number;
  receivable: number;
};
type AreaProductRow = {
  product_id: string;
  product_name: string;
  product_type: string;
  sellers: number;
  buyers: number;
  orders: number;
  units: number;
  gross_sales: number;
  cost: number;
  gross_profit: number;
  collected: number;
  receivable: number;
};
type MarketArea = {
  region_code: string | null;
  region_name: string | null;
  province_code: string | null;
  province_name: string | null;
  city_muni_code: string | null;
  city_muni_name: string | null;
};
type MarketSupplier = {
  seller_id: string;
  seller_name: string;
  seller_username: string;
  seller_level: string;
  region_name: string | null;
  province_name: string | null;
  city_muni_name: string | null;
  orders: number;
  resellers: number;
  units: number;
  gross_sales: number;
  local_units: number;
  outside_units: number;
};
type Data = {
  summary: Record<string, number>;
  routes: Breakdown[];
  liquidation: Breakdown[];
  products: Breakdown[];
  movements: Movement[];
  activation: Record<string, number>;
  activation_breakdown: Array<{
    channel: string;
    activations: number;
    customer_payments: number;
    product_portion: number;
    product_cost: number;
    product_profit: number;
    pin_allocation: number;
  }>;
  pagination: {
    page: number;
    page_size: number;
    total_count: number;
    total_pages: number;
  };
  notes: Record<string, string>;
  directory: {
    distributors: DistributorOption[];
    products: Array<{ id: string; name: string }>;
  };
  selected_distributor: DistributorOption | null;
  distributor_analysis: Record<string, number>;
  distributor_trend: Trend[];
  area_summary: Record<string, number>;
  area_analysis: AreaRow[];
  area_trend: Trend[];
  area_products: AreaProductRow[];
  area_coverage: Record<string, number>;
  market_summary: Record<string, number>;
  market_analysis: AreaRow[];
  market_products: AreaProductRow[];
  market_suppliers: MarketSupplier[];
  market_areas: MarketArea[];
};
type Tab =
  | "overview"
  | "movements"
  | "distributor"
  | "area"
  | "activation"
  | "liquidation";
const initial = getDateRangePreset("this_month");
const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});
const number = (value: number | undefined) =>
  Number(value || 0).toLocaleString();
const levels = [
  "all",
  "admin",
  "regional",
  "provincial",
  "city",
  "branch",
  "reseller",
];

function Metric({
  label,
  value,
  note,
  accent,
}: {
  label: string;
  value: string;
  note: string;
  accent: string;
}) {
  return (
    <article
      className="rounded-2xl border border-slate-200 border-t-4 bg-white p-5 shadow-sm"
      style={{ borderTopColor: accent }}
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold text-[#0D1B3E]">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{note}</p>
    </article>
  );
}

export default function SalesMovementPage() {
  const [tab, setTab] = useState<Tab>("overview"),
    [preset, setPreset] = useState<DateRangePreset>("this_month");
  const [from, setFrom] = useState(initial.from),
    [to, setTo] = useState(initial.to),
    [sellerLevel, setSellerLevel] = useState("all"),
    [buyerLevel, setBuyerLevel] = useState("all"),
    [status, setStatus] = useState("delivered"),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1);
  const [distributorId, setDistributorId] = useState(""),
    [productId, setProductId] = useState(""),
    [regionCode, setRegionCode] = useState(""),
    [provinceCode, setProvinceCode] = useState(""),
    [cityCode, setCityCode] = useState("");
  const [areaView, setAreaView] = useState<"market" | "fulfillment">("market");
  const [distributorLevel, setDistributorLevel] = useState("all"),
    [distributorQuery, setDistributorQuery] = useState(""),
    [showDistributorMatches, setShowDistributorMatches] = useState(false);
  const [data, setData] = useState<Data | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const load = async (
    start = from,
    end = to,
    nextPage = page,
    nextSeller = sellerLevel,
    nextBuyer = buyerLevel,
    nextStatus = status,
    nextDistributor = distributorId,
    nextProduct = productId,
    nextRegion = regionCode,
    nextProvince = provinceCode,
    nextCity = cityCode,
  ) => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      from: start,
      to: end,
      seller_level: nextSeller,
      buyer_level: nextBuyer,
      status: nextStatus,
      search,
      page: String(nextPage),
      page_size: "50",
      distributor_id: nextDistributor,
      product_id: nextProduct,
      region_code: nextRegion,
      province_code: nextProvince,
      city_code: nextCity,
    });
    try {
      const response = await fetch(`/api/admin/sales-movement?${params}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload)
        throw new Error(
          payload?.error || "Unable to load sales and product movement.",
        );
      setData(payload);
      setPage(payload.pagination.page);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load sales and product movement.",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    const timer = window.setTimeout(
      () => void load(initial.from, initial.to, 1),
      0,
    );
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const choosePreset = (value: DateRangePreset) => {
    setPreset(value);
    if (value === "custom") return;
    const range = getDateRangePreset(value);
    setFrom(range.from);
    setTo(range.to);
    setPage(1);
    void load(range.from, range.to, 1);
  };
  const changeSeller = (value: string) => {
    setSellerLevel(value);
    setPage(1);
    void load(from, to, 1, value, buyerLevel, status);
  };
  const changeBuyer = (value: string) => {
    setBuyerLevel(value);
    setPage(1);
    void load(from, to, 1, sellerLevel, value, status);
  };
  const changeStatus = (value: string) => {
    setStatus(value);
    setPage(1);
    void load(from, to, 1, sellerLevel, buyerLevel, value);
  };
  const summary = data?.summary || {},
    activation = data?.activation || {};
  const distributor = data?.distributor_analysis || {},
    fulfillmentArea = data?.area_summary || {},
    marketArea = data?.market_summary || {};
  const area = areaView === "market" ? marketArea : fulfillmentArea;
  const areaMonthlyAverage =
    Number(area.gross_sales || 0) / Math.max(1, data?.area_trend.length || 0);
  const distributorMatches = (data?.directory.distributors || [])
    .filter((item) => {
      const profile = item.distributor_profile;
      if (
        distributorLevel !== "all" &&
        profile?.dist_level !== distributorLevel
      )
        return false;
      const term = distributorQuery.trim().toLowerCase();
      if (!term) return true;
      return [
        item.full_name,
        item.username,
        profile?.coverage_area,
        profile?.region_name,
        profile?.province_name,
        profile?.city_muni_name,
        profile?.dist_level,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term);
    })
    .slice(0, 12);
  const selectDistributor = (item: DistributorOption) => {
    setDistributorId(item.id);
    setDistributorQuery(
      `${item.full_name} (@${item.username}) · ${item.distributor_profile?.dist_level || item.role}`,
    );
    setShowDistributorMatches(false);
  };
  const distributorAreas: MarketArea[] = (data?.directory.distributors || [])
    .map((item) => item.distributor_profile)
    .filter(
      (item): item is NonNullable<DistributorOption["distributor_profile"]> =>
        Boolean(item),
    );
  const selectableAreas = [...(data?.market_areas || []), ...distributorAreas];
  const regions = Array.from(
    new Map(
      selectableAreas
        .filter((item) => item.region_code)
        .map((item) => [
          item.region_code!,
          {
            code: item.region_code!,
            name: item.region_name || item.region_code!,
          },
        ]),
    ).values(),
  );
  const provinces = Array.from(
    new Map(
      selectableAreas
        .filter(
          (item) =>
            item.province_code &&
            (!regionCode || item.region_code === regionCode),
        )
        .map((item) => [
          item.province_code!,
          {
            code: item.province_code!,
            name: item.province_name || item.province_code!,
          },
        ]),
    ).values(),
  );
  const cities = Array.from(
    new Map(
      selectableAreas
        .filter(
          (item) =>
            item.city_muni_code &&
            (!provinceCode || item.province_code === provinceCode) &&
            (!regionCode || item.region_code === regionCode),
        )
        .map((item) => [
          item.city_muni_code!,
          {
            code: item.city_muni_code!,
            name: item.city_muni_name || item.city_muni_code!,
          },
        ]),
    ).values(),
  );
  const areaProducts =
    areaView === "market"
      ? data?.market_products || []
      : data?.area_products || [];
  const areaRows =
    areaView === "market"
      ? data?.market_analysis || []
      : data?.area_analysis || [];
  const territoryOccupied = Object.values(data?.area_coverage || {}).some(
    (value) => Number(value) > 0,
  );
  const demandTarget = 10000;
  const demandProgress = Math.min(
    100,
    (Number(marketArea.units || 0) / demandTarget) * 100,
  );
  const companyContribution =
    Number(summary.admin_profit || 0) + Number(activation.pin_allocation || 0);
  const tabs: Array<[Tab, string]> = [
    ["overview", "Overview"],
    ["movements", "Product Movement"],
    ["distributor", "Distributor Analysis"],
    ["area", "Area Analysis"],
    ["activation", "PIN & Activation"],
    ["liquidation", "Liquidation"],
  ];
  return (
    <main className="mx-auto w-full max-w-[1550px] p-4 text-[#0D1B3E] sm:p-8">
      <header className="flex flex-col gap-4 border-b border-[#0D1B3E]/10 pb-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.2em] text-[#C9A84C]">
            Finance and accounting
          </p>
          <h1 className="mt-1 text-2xl font-bold">Sales & Product Movement</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Trace seller-to-buyer product movement, separate Admin sales from
            network turnover, and prepare sales liquidation using historical
            cost snapshots.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-500">
            Period
            <select
              aria-label="Period"
              value={preset}
              onChange={(event) =>
                choosePreset(event.target.value as DateRangePreset)
              }
              className="mt-1 block rounded-lg border bg-white px-3 py-2 text-sm"
            >
              {datePresetOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {preset === "custom" && (
            <>
              <label className="text-xs text-slate-500">
                From
                <input
                  type="date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  className="mt-1 block rounded-lg border px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs text-slate-500">
                To
                <input
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  className="mt-1 block rounded-lg border px-3 py-2 text-sm"
                />
              </label>
            </>
          )}
          <button
            onClick={() => void load(from, to, 1)}
            disabled={loading}
            className="rounded-lg bg-[#0D1B3E] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? "Loading…" : "Apply"}
          </button>
        </div>
      </header>
      <div className="mt-4 flex gap-1 overflow-x-auto rounded-xl border bg-white p-1">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold ${tab === key ? "bg-[#0D1B3E] text-white" : "text-slate-500 hover:bg-slate-50"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <div className="mt-4 flex justify-between rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => void load()} className="font-bold">
            Try again
          </button>
        </div>
      )}
      {tab === "overview" && (
        <>
          <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Metric
              label="Admin product gross sales"
              value={peso.format(summary.admin_gross_sales || 0)}
              note="Delivered product sales where Admin is seller"
              accent="#2563eb"
            />
            <Metric
              label="Admin product cost"
              value={peso.format(summary.admin_cost || 0)}
              note="Historical acquisition/manufacturing cost"
              accent="#dc2626"
            />
            <Metric
              label="Admin product gross profit"
              value={peso.format(summary.admin_profit || 0)}
              note="Admin gross sales minus product cost"
              accent="#059669"
            />
            <Metric
              label="PIN allocation"
              value={peso.format(activation.pin_allocation || 0)}
              note={`${number(activation.activations)} registrations and upgrades`}
              accent="#C9A84C"
            />
            <Metric
              label="Company contribution"
              value={peso.format(companyContribution)}
              note="Admin product gross profit + PIN allocation"
              accent="#7c3aed"
            />
          </section>
          <section className="mt-5 grid gap-5 xl:grid-cols-2">
            <article className="rounded-2xl border bg-white p-5">
              <h2 className="font-bold">Network product turnover</h2>
              <p className="mt-1 text-xs text-slate-500">
                Every delivered movement across the chain; not unique
                end-customer revenue
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 p-4">
                  <small>Gross turnover</small>
                  <b className="mt-1 block text-xl">
                    {peso.format(summary.gross_sales || 0)}
                  </b>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <small>Units moved</small>
                  <b className="mt-1 block text-xl">{number(summary.units)}</b>
                </div>
                <div className="rounded-xl bg-emerald-50 p-4">
                  <small>Collected</small>
                  <b className="mt-1 block text-xl text-emerald-700">
                    {peso.format(summary.collected || 0)}
                  </b>
                </div>
                <div className="rounded-xl bg-amber-50 p-4">
                  <small>Receivable</small>
                  <b className="mt-1 block text-xl text-amber-700">
                    {peso.format(summary.receivable || 0)}
                  </b>
                </div>
              </div>
            </article>
            <article className="rounded-2xl border bg-white p-5">
              <h2 className="font-bold">Movement routes</h2>
              <p className="mt-1 text-xs text-slate-500">
                Seller → buyer destination
              </p>
              <div className="mt-4 space-y-3">
                {data?.routes.length ? (
                  data.routes.map((route) => (
                    <div
                      key={route.key}
                      className="flex items-center justify-between border-b pb-2 text-sm"
                    >
                      <span>
                        <b>{route.label}</b>
                        <small className="block text-slate-400">
                          {route.orders} orders · {route.units} units
                        </small>
                      </span>
                      <span className="text-right">
                        <b>{peso.format(route.gross_sales)}</b>
                        <small className="block text-emerald-600">
                          Profit {peso.format(route.gross_profit)}
                        </small>
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="py-8 text-center text-slate-400">
                    No delivered movements in this period.
                  </p>
                )}
              </div>
            </article>
          </section>
          <details className="mt-5 rounded-xl border bg-white p-4 text-sm">
            <summary className="cursor-pointer font-bold">
              Accounting definitions and safeguards
            </summary>
            <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
              {Object.values(data?.notes || {}).map((note) => (
                <p key={note} className="rounded-lg bg-slate-50 p-3">
                  {note}
                </p>
              ))}
            </div>
          </details>
        </>
      )}
      {tab === "movements" && (
        <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
          <div className="flex flex-col gap-3 border-b p-4 xl:flex-row xl:items-end">
            <div className="mr-auto">
              <h2 className="font-bold">Product movement ledger</h2>
              <p className="text-xs text-slate-500">
                Filter the source and destination independently
              </p>
            </div>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void load(from, to, 1);
              }}
              placeholder="Order, product, seller, buyer…"
              className="min-w-64 rounded-lg border px-3 py-2 text-sm"
            />
            <select
              aria-label="Sold by"
              value={sellerLevel}
              onChange={(event) => changeSeller(event.target.value)}
              className="rounded-lg border px-3 py-2 text-sm"
            >
              {levels.map((level) => (
                <option key={level} value={level}>
                  Sold by: {level === "all" ? "All levels" : level}
                </option>
              ))}
            </select>
            <select
              aria-label="Sold to"
              value={buyerLevel}
              onChange={(event) => changeBuyer(event.target.value)}
              className="rounded-lg border px-3 py-2 text-sm"
            >
              {levels
                .filter((level) => level !== "admin")
                .map((level) => (
                  <option key={level} value={level}>
                    Sold to: {level === "all" ? "All levels" : level}
                  </option>
                ))}
            </select>
            <select
              aria-label="Status"
              value={status}
              onChange={(event) => changeStatus(event.target.value)}
              className="rounded-lg border px-3 py-2 text-sm"
            >
              {["delivered", "pending", "processing", "cancelled", "all"].map(
                (value) => (
                  <option key={value} value={value}>
                    Status: {value}
                  </option>
                ),
              )}
            </select>
            <button
              onClick={() => void load(from, to, 1)}
              className="rounded-lg bg-[#0D1B3E] px-4 py-2 text-sm font-semibold text-white"
            >
              Search
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1350px] text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                <tr>
                  {[
                    "Date / order",
                    "Movement",
                    "Product",
                    "Qty",
                    "Unit price",
                    "Unit cost",
                    "Gross",
                    "Cost",
                    "Gross profit",
                    "Payment",
                    "Cost quality",
                  ].map((label) => (
                    <th key={label} className="px-4 py-3">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {data?.movements.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <b className="block text-xs">
                        {new Date(row.event_at).toLocaleString("en-PH")}
                      </b>
                      <span className="text-[10px] text-slate-400">
                        {row.order_number || row.order_id.slice(0, 10)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <b>{row.seller_name}</b>
                      <span className="block text-xs capitalize text-slate-500">
                        {row.seller_level} → {row.buyer_level}
                      </span>
                      <span className="block text-xs text-slate-400">
                        {row.buyer_name}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold">
                      {row.product_name}
                    </td>
                    <td className="px-4 py-3">{row.quantity}</td>
                    <td className="px-4 py-3">{peso.format(row.unit_price)}</td>
                    <td className="px-4 py-3">{peso.format(row.unit_cost)}</td>
                    <td className="px-4 py-3 font-semibold text-blue-700">
                      {peso.format(row.gross_sales)}
                    </td>
                    <td className="px-4 py-3 text-red-600">
                      {peso.format(row.cost)}
                    </td>
                    <td
                      className={`px-4 py-3 font-bold ${row.gross_profit >= 0 ? "text-emerald-700" : "text-red-700"}`}
                    >
                      {peso.format(row.gross_profit)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="capitalize">
                        {row.payment_status || "unpaid"}
                      </span>
                      <small className="block capitalize text-slate-400">
                        {row.status}
                      </small>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${row.cost_quality === "catalog fallback" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}
                      >
                        {row.cost_quality}
                      </span>
                    </td>
                  </tr>
                ))}
                {data && data.movements.length === 0 && (
                  <tr>
                    <td
                      colSpan={11}
                      className="p-10 text-center text-slate-400"
                    >
                      No matching product movements.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {data && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-xs text-slate-500">
              <span>
                Showing{" "}
                {data.pagination.total_count
                  ? (page - 1) * data.pagination.page_size + 1
                  : 0}
                –
                {Math.min(
                  page * data.pagination.page_size,
                  data.pagination.total_count,
                )}{" "}
                of {data.pagination.total_count}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1 || loading}
                  onClick={() => void load(from, to, page - 1)}
                  className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="px-2 py-1.5">
                  Page {page} of {data.pagination.total_pages}
                </span>
                <button
                  disabled={page >= data.pagination.total_pages || loading}
                  onClick={() => void load(from, to, page + 1)}
                  className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </section>
      )}
      {tab === "distributor" && (
        <>
          <section className="mt-5 rounded-2xl border bg-white p-4">
            <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-end">
              <div className="mr-auto">
                <h2 className="font-bold">Distributor sales profile</h2>
                <p className="text-xs text-slate-500">
                  Filter by distributor type, then search by name, username, or
                  registered coverage area
                </p>
              </div>
              <div className="grid w-full gap-3 sm:grid-cols-2 xl:grid-cols-[180px_minmax(280px,1fr)_220px_auto] 2xl:w-auto">
                <label className="text-xs text-slate-500">
                  Distributor type
                  <select
                    aria-label="Distributor type"
                    value={distributorLevel}
                    onChange={(event) => {
                      setDistributorLevel(event.target.value);
                      setDistributorId("");
                      setDistributorQuery("");
                      setShowDistributorMatches(true);
                    }}
                    className="mt-1 block w-full rounded-lg border bg-white px-3 py-2 text-sm"
                  >
                    <option value="all">All distributor types</option>
                    <option value="regional">Regional Distributor</option>
                    <option value="provincial">Provincial Distributor</option>
                    <option value="city">City Distributor</option>
                    <option value="branch">Hiroma Branch</option>
                  </select>
                </label>
                <label className="relative text-xs text-slate-500">
                  Search distributor or area
                  <input
                    role="combobox"
                    aria-label="Search distributor or area"
                    aria-expanded={showDistributorMatches}
                    aria-controls="distributor-search-results"
                    autoComplete="off"
                    value={distributorQuery}
                    onFocus={() => setShowDistributorMatches(true)}
                    onBlur={() =>
                      window.setTimeout(
                        () => setShowDistributorMatches(false),
                        120,
                      )
                    }
                    onChange={(event) => {
                      setDistributorQuery(event.target.value);
                      setDistributorId("");
                      setShowDistributorMatches(true);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && distributorMatches[0]) {
                        event.preventDefault();
                        selectDistributor(distributorMatches[0]);
                      }
                      if (event.key === "Escape")
                        setShowDistributorMatches(false);
                    }}
                    placeholder="Name, username, Davao, Cebu…"
                    className="mt-1 block w-full rounded-lg border px-3 py-2 text-sm text-[#0D1B3E] placeholder:text-slate-400"
                  />
                  {showDistributorMatches && (
                    <div
                      id="distributor-search-results"
                      role="listbox"
                      onMouseDown={(event) => event.preventDefault()}
                      className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border bg-white p-1 shadow-xl"
                    >
                      {distributorMatches.map((item) => (
                        <button
                          type="button"
                          role="option"
                          aria-selected={item.id === distributorId}
                          key={item.id}
                          onClick={() => selectDistributor(item)}
                          className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                        >
                          <span className="block text-sm font-semibold text-[#0D1B3E]">
                            {item.full_name}{" "}
                            <span className="font-normal text-slate-400">
                              @{item.username}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-[11px] capitalize text-slate-500">
                            {item.distributor_profile?.dist_level} ·{" "}
                            {item.distributor_profile?.coverage_area ||
                              "Area not specified"}
                          </span>
                        </button>
                      ))}
                      {distributorMatches.length === 0 && (
                        <p className="px-3 py-6 text-center text-xs text-slate-400">
                          No distributor matches this type and search.
                        </p>
                      )}
                    </div>
                  )}
                </label>
                <label className="text-xs text-slate-500">
                  Product
                  <select
                    aria-label="Distributor product"
                    value={productId}
                    onChange={(event) => setProductId(event.target.value)}
                    className="mt-1 block w-full rounded-lg border bg-white px-3 py-2 text-sm"
                  >
                    <option value="">All products</option>
                    {data?.directory.products.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  disabled={!distributorId || loading}
                  onClick={() =>
                    void load(
                      from,
                      to,
                      1,
                      sellerLevel,
                      buyerLevel,
                      status,
                      distributorId,
                      productId,
                    )
                  }
                  className="self-end rounded-lg bg-[#0D1B3E] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Analyze distributor
                </button>
              </div>
            </div>
          </section>
          {!data?.selected_distributor ? (
            <div className="mt-5 rounded-2xl border border-dashed bg-white p-12 text-center text-sm text-slate-400">
              Select a distributor to view complete sales and purchase
              performance.
            </div>
          ) : (
            <>
              <section className="mt-5 rounded-2xl border bg-white p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-[#C9A84C]">
                  {data.selected_distributor.distributor_profile?.dist_level}
                </p>
                <h2 className="mt-1 text-xl font-bold">
                  {data.selected_distributor.full_name}{" "}
                  <span className="text-sm font-normal text-slate-400">
                    @{data.selected_distributor.username}
                  </span>
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {data.selected_distributor.distributor_profile
                    ?.coverage_area || "No coverage area recorded"}
                </p>
              </section>
              <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                <Metric
                  label="Gross sales"
                  value={peso.format(distributor.gross_sales || 0)}
                  note={`${number(distributor.sold_orders)} delivered orders`}
                  accent="#2563eb"
                />
                <Metric
                  label="Product cost"
                  value={peso.format(distributor.cost || 0)}
                  note="Snapshot-first cost"
                  accent="#dc2626"
                />
                <Metric
                  label="Gross profit"
                  value={peso.format(distributor.gross_profit || 0)}
                  note="Sales minus product cost"
                  accent="#059669"
                />
                <Metric
                  label="Purchases"
                  value={peso.format(distributor.purchases || 0)}
                  note={`${number(distributor.purchase_orders)} supplier orders`}
                  accent="#7c3aed"
                />
                <Metric
                  label="Units sold / bought"
                  value={`${number(distributor.sold_units)} / ${number(distributor.purchased_units)}`}
                  note="Outbound / inbound units"
                  accent="#0D1B3E"
                />
                <Metric
                  label="Receivable"
                  value={peso.format(distributor.receivable || 0)}
                  note={`Collected ${peso.format(distributor.collected || 0)}`}
                  accent="#d97706"
                />
              </section>
              <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
                <div className="border-b p-4">
                  <h2 className="font-bold">Monthly performance</h2>
                  <p className="text-xs text-slate-500">
                    Use this trend for performance review and liquidation
                    support
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[850px] text-left text-sm">
                    <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                      <tr>
                        {[
                          "Month",
                          "Gross sales",
                          "Cost",
                          "Gross profit",
                          "Purchases",
                          "Units sold",
                          "Units purchased",
                        ].map((label) => (
                          <th key={label} className="px-4 py-3">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.distributor_trend.map((row) => (
                        <tr key={row.period}>
                          <td className="px-4 py-3 font-semibold">
                            {new Date(row.period).toLocaleDateString("en-PH", {
                              month: "long",
                              year: "numeric",
                            })}
                          </td>
                          <td className="px-4 py-3 text-blue-700">
                            {peso.format(row.gross_sales)}
                          </td>
                          <td className="px-4 py-3 text-red-600">
                            {peso.format(row.cost)}
                          </td>
                          <td className="px-4 py-3 font-bold text-emerald-700">
                            {peso.format(row.gross_profit)}
                          </td>
                          <td className="px-4 py-3 text-violet-700">
                            {peso.format(row.purchases)}
                          </td>
                          <td className="px-4 py-3">
                            {number(row.units_sold)}
                          </td>
                          <td className="px-4 py-3">
                            {number(row.units_purchased)}
                          </td>
                        </tr>
                      ))}
                      {data.distributor_trend.length === 0 && (
                        <tr>
                          <td
                            colSpan={7}
                            className="p-10 text-center text-slate-400"
                          >
                            No delivered sales or purchases in this period.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      )}
      {tab === "area" && (
        <>
          <section className="mt-5 rounded-2xl border bg-white p-4">
            <div className="mb-4 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-bold">Geographic product analysis</h2>
                <p className="text-xs text-slate-500">
                  Market Demand follows the reseller&apos;s registered area;
                  Actual Sales follows the seller/outlet.
                </p>
              </div>
              <div className="flex rounded-xl bg-slate-100 p-1">
                <button
                  onClick={() => setAreaView("market")}
                  className={`rounded-lg px-4 py-2 text-xs font-bold ${areaView === "market" ? "bg-[#0D1B3E] text-white" : "text-slate-500"}`}
                >
                  Market Demand
                </button>
                <button
                  onClick={() => setAreaView("fulfillment")}
                  className={`rounded-lg px-4 py-2 text-xs font-bold ${areaView === "fulfillment" ? "bg-[#0D1B3E] text-white" : "text-slate-500"}`}
                >
                  Actual Sales / Fulfillment
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
              <div className="mr-auto text-xs text-slate-500">
                {areaView === "market"
                  ? "Demand is analytical only and does not create additional revenue."
                  : "Revenue and inventory movement credited to the actual seller."}
              </div>
              <label className="text-xs text-slate-500">
                Region
                <select
                  aria-label="Region"
                  value={regionCode}
                  onChange={(event) => {
                    setRegionCode(event.target.value);
                    setProvinceCode("");
                    setCityCode("");
                  }}
                  className="mt-1 block min-w-52 rounded-lg border px-3 py-2 text-sm"
                >
                  <option value="">All regions</option>
                  {regions.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-500">
                Province
                <select
                  aria-label="Province"
                  value={provinceCode}
                  onChange={(event) => {
                    setProvinceCode(event.target.value);
                    setCityCode("");
                  }}
                  className="mt-1 block min-w-52 rounded-lg border px-3 py-2 text-sm"
                >
                  <option value="">All provinces</option>
                  {provinces.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-500">
                City / municipality
                <select
                  aria-label="City or municipality"
                  value={cityCode}
                  onChange={(event) => setCityCode(event.target.value)}
                  className="mt-1 block min-w-52 rounded-lg border px-3 py-2 text-sm"
                >
                  <option value="">All cities</option>
                  {cities.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-500">
                Product
                <select
                  aria-label="Area product"
                  value={productId}
                  onChange={(event) => setProductId(event.target.value)}
                  className="mt-1 block min-w-48 rounded-lg border px-3 py-2 text-sm"
                >
                  <option value="">All products</option>
                  {data?.directory.products.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={loading}
                onClick={() =>
                  void load(
                    from,
                    to,
                    1,
                    sellerLevel,
                    buyerLevel,
                    status,
                    distributorId,
                    productId,
                    regionCode,
                    provinceCode,
                    cityCode,
                  )
                }
                className="rounded-lg bg-[#0D1B3E] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                Analyze area
              </button>
            </div>
          </section>
          {areaView === "market" ? (
            <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
              <Metric
                label="Market demand"
                value={`${number(area.units)} bottles`}
                note={`${number(area.orders)} delivered orders`}
                accent="#2563eb"
              />
              <Metric
                label="Purchase value"
                value={peso.format(area.gross_sales || 0)}
                note="Same sales, grouped by buyer area"
                accent="#0ea5e9"
              />
              <Metric
                label="Active purchasing resellers"
                value={number(area.buyers)}
                note="Unique reseller buyers"
                accent="#7c3aed"
              />
              <Metric
                label="Fulfillment sources"
                value={number(area.sellers)}
                note="Actual sellers serving this market"
                accent="#0D1B3E"
              />
              <Metric
                label="Served locally"
                value={number(area.local_units)}
                note="Seller and buyer market city match"
                accent="#059669"
              />
              <Metric
                label="Served outside area"
                value={number(area.outside_units)}
                note="Demand fulfilled from another city"
                accent="#d97706"
              />
              <Metric
                label="Territory status"
                value={territoryOccupied ? "Occupied" : "Open"}
                note={
                  territoryOccupied
                    ? "Registered coverage exists"
                    : "Open for distributorship"
                }
                accent="#C9A84C"
              />
              <Metric
                label="10,000 target"
                value={`${demandProgress.toFixed(1)}%`}
                note={`${number(area.units)} of ${number(demandTarget)} bottles`}
                accent="#dc2626"
              />
            </section>
          ) : (
            <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
              <Metric
                label="Area gross sales"
                value={peso.format(area.gross_sales || 0)}
                note={`${number(area.orders)} delivered orders`}
                accent="#2563eb"
              />
              <Metric
                label="Monthly average"
                value={peso.format(areaMonthlyAverage)}
                note={`${number(data?.area_trend.length)} active sales months`}
                accent="#0ea5e9"
              />
              <Metric
                label="Product cost"
                value={peso.format(area.cost || 0)}
                note="Snapshot-first cost"
                accent="#dc2626"
              />
              <Metric
                label="Area gross profit"
                value={peso.format(area.gross_profit || 0)}
                note="Sales minus cost"
                accent="#059669"
              />
              <Metric
                label="Units moved"
                value={number(area.units)}
                note="Products sold by area sellers"
                accent="#0D1B3E"
              />
              <Metric
                label="Collected"
                value={peso.format(area.collected || 0)}
                note="Paid delivered sales"
                accent="#7c3aed"
              />
              <Metric
                label="Receivable"
                value={peso.format(area.receivable || 0)}
                note="Delivered but not yet paid"
                accent="#d97706"
              />
              <Metric
                label="Coverage"
                value={`${number(data?.area_coverage.regional)} R · ${number(data?.area_coverage.provincial)} P`}
                note={`${number(data?.area_coverage.city)} city · ${number(data?.area_coverage.branch)} branch`}
                accent="#C9A84C"
              />
            </section>
          )}
          {areaView === "market" && (
            <>
              <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
                <div className="flex flex-col gap-1 border-b p-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="font-bold">
                      Products demanded in this market
                    </h2>
                    <p className="text-xs text-slate-500">
                      Delivered purchases grouped by each reseller buyer&apos;s
                      registered address
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-slate-500">
                    {productId ? "Specific product" : "All products"} ·{" "}
                    {number(areaProducts.length)} result(s)
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1050px] text-left text-sm">
                    <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                      <tr>
                        {[
                          "Product",
                          "Type",
                          "Resellers",
                          "Orders",
                          "Demand units",
                          "Purchase value",
                          "Collected",
                          "Receivable",
                        ].map((label) => (
                          <th key={label} className="px-4 py-3">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {areaProducts.map((row) => (
                        <tr key={row.product_id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-semibold">
                            {row.product_name}
                          </td>
                          <td className="px-4 py-3">
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-600">
                              {row.product_type}
                            </span>
                          </td>
                          <td className="px-4 py-3">{number(row.buyers)}</td>
                          <td className="px-4 py-3">{number(row.orders)}</td>
                          <td className="px-4 py-3 font-bold text-[#0D1B3E]">
                            {number(row.units)}
                          </td>
                          <td className="px-4 py-3 font-semibold text-blue-700">
                            {peso.format(row.gross_sales)}
                          </td>
                          <td className="px-4 py-3 text-violet-700">
                            {peso.format(row.collected)}
                          </td>
                          <td className="px-4 py-3 text-amber-700">
                            {peso.format(row.receivable)}
                          </td>
                        </tr>
                      ))}
                      {areaProducts.length === 0 && (
                        <tr>
                          <td
                            colSpan={8}
                            className="p-10 text-center text-slate-400"
                          >
                            No delivered reseller purchases were recorded in
                            this market and period.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
                <div className="border-b p-4">
                  <h2 className="font-bold">Where this market purchased</h2>
                  <p className="text-xs text-slate-500">
                    Actual distributors, branches, or sellers that fulfilled the
                    demand—without creating duplicate revenue
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1100px] text-left text-sm">
                    <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                      <tr>
                        {[
                          "Supplier / outlet",
                          "Type",
                          "Fulfillment location",
                          "Resellers",
                          "Orders",
                          "Units",
                          "Same city",
                          "Outside city",
                          "Actual sales",
                        ].map((label) => (
                          <th key={label} className="px-4 py-3">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data?.market_suppliers.map((row) => (
                        <tr key={row.seller_id} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <div className="font-semibold">
                              {row.seller_name}
                            </div>
                            <div className="text-xs text-slate-400">
                              @{row.seller_username}
                            </div>
                          </td>
                          <td className="px-4 py-3 capitalize">
                            {row.seller_level?.replaceAll("_", " ") ||
                              "Reseller"}
                          </td>
                          <td className="px-4 py-3">
                            {[
                              row.city_muni_name,
                              row.province_name,
                              row.region_name,
                            ]
                              .filter(Boolean)
                              .join(", ") || "Not specified"}
                          </td>
                          <td className="px-4 py-3">{number(row.resellers)}</td>
                          <td className="px-4 py-3">{number(row.orders)}</td>
                          <td className="px-4 py-3 font-bold">
                            {number(row.units)}
                          </td>
                          <td className="px-4 py-3 text-emerald-700">
                            {number(row.local_units)}
                          </td>
                          <td className="px-4 py-3 text-amber-700">
                            {number(row.outside_units)}
                          </td>
                          <td className="px-4 py-3 font-semibold text-blue-700">
                            {peso.format(row.gross_sales)}
                          </td>
                        </tr>
                      ))}
                      {data && data.market_suppliers.length === 0 && (
                        <tr>
                          <td
                            colSpan={9}
                            className="p-10 text-center text-slate-400"
                          >
                            No fulfillment sources were found for this market
                            and period.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
                <div className="border-b p-4">
                  <h2 className="font-bold">
                    Market demand by registered area
                  </h2>
                  <p className="text-xs text-slate-500">
                    Use this demand evidence to identify territories that may
                    qualify for a distributor
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1000px] text-left text-sm">
                    <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                      <tr>
                        {[
                          "Region",
                          "Province",
                          "City / municipality",
                          "Resellers",
                          "Sources",
                          "Orders",
                          "Demand units",
                          "Purchase value",
                        ].map((label) => (
                          <th key={label} className="px-4 py-3">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {areaRows.map((row) => (
                        <tr key={row.key}>
                          <td className="px-4 py-3 font-semibold">
                            {row.region_name || "Not specified"}
                          </td>
                          <td className="px-4 py-3">
                            {row.province_name || "All / not specified"}
                          </td>
                          <td className="px-4 py-3">
                            {row.city_muni_name || "All / not specified"}
                          </td>
                          <td className="px-4 py-3">{number(row.buyers)}</td>
                          <td className="px-4 py-3">{number(row.sellers)}</td>
                          <td className="px-4 py-3">{number(row.orders)}</td>
                          <td className="px-4 py-3 font-bold">
                            {number(row.units)}
                          </td>
                          <td className="px-4 py-3 font-semibold text-blue-700">
                            {peso.format(row.gross_sales)}
                          </td>
                        </tr>
                      ))}
                      {areaRows.length === 0 && (
                        <tr>
                          <td
                            colSpan={8}
                            className="p-10 text-center text-slate-400"
                          >
                            No market demand was recorded in this scope.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="border-t bg-blue-50 p-4 text-xs text-blue-900">
                  <b>No double counting:</b> these are the same delivered sales
                  grouped by the buyer reseller&apos;s immutable
                  registered-location snapshot. Revenue remains credited only to
                  the actual seller shown in the fulfillment breakdown.
                </div>
              </section>
            </>
          )}
          {areaView === "fulfillment" && (
            <>
              <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
                <div className="flex flex-col gap-1 border-b p-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="font-bold">
                      Products sold in selected area
                    </h2>
                    <p className="text-xs text-slate-500">
                      See every product type and its delivered sales performance
                      for the selected region, province, or city
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-slate-500">
                    {productId ? "Specific product" : "All products"} ·{" "}
                    {number(data?.area_products.length)} result(s)
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1250px] text-left text-sm">
                    <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                      <tr>
                        {[
                          "Product",
                          "Type",
                          "Sellers",
                          "Buyers",
                          "Orders",
                          "Units sold",
                          "Gross sales",
                          "Cost",
                          "Gross profit",
                          "Collected",
                          "Receivable",
                        ].map((label) => (
                          <th key={label} className="px-4 py-3">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data?.area_products.map((row) => (
                        <tr key={row.product_id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-semibold">
                            {row.product_name}
                          </td>
                          <td className="px-4 py-3">
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-600">
                              {row.product_type}
                            </span>
                          </td>
                          <td className="px-4 py-3">{number(row.sellers)}</td>
                          <td className="px-4 py-3">{number(row.buyers)}</td>
                          <td className="px-4 py-3">{number(row.orders)}</td>
                          <td className="px-4 py-3 font-bold text-[#0D1B3E]">
                            {number(row.units)}
                          </td>
                          <td className="px-4 py-3 font-semibold text-blue-700">
                            {peso.format(row.gross_sales)}
                          </td>
                          <td className="px-4 py-3 text-red-600">
                            {peso.format(row.cost)}
                          </td>
                          <td
                            className={`px-4 py-3 font-bold ${row.gross_profit >= 0 ? "text-emerald-700" : "text-red-700"}`}
                          >
                            {peso.format(row.gross_profit)}
                          </td>
                          <td className="px-4 py-3 text-violet-700">
                            {peso.format(row.collected)}
                          </td>
                          <td className="px-4 py-3 text-amber-700">
                            {peso.format(row.receivable)}
                          </td>
                        </tr>
                      ))}
                      {data && data.area_products.length === 0 && (
                        <tr>
                          <td
                            colSpan={11}
                            className="p-10 text-center text-slate-400"
                          >
                            No delivered products were sold in this area and
                            period.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="border-t bg-slate-50 p-4 text-xs text-slate-600">
                  <b>Reading the table:</b> monetary values and units add up to
                  the selected-area totals above. An order containing more than
                  one product may appear in more than one product row, so use
                  the Area gross sales card for the authoritative overall total.
                </div>
              </section>
              <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
                <div className="border-b p-4">
                  <h2 className="font-bold">Monthly area performance</h2>
                  <p className="text-xs text-slate-500">
                    Compare sustained sales demand—not only one-time spikes
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-left text-sm">
                    <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                      <tr>
                        {[
                          "Month",
                          "Gross sales",
                          "Cost",
                          "Gross profit",
                          "Units moved",
                        ].map((label) => (
                          <th key={label} className="px-4 py-3">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data?.area_trend.map((row) => (
                        <tr key={row.period}>
                          <td className="px-4 py-3 font-semibold">
                            {new Date(row.period).toLocaleDateString("en-PH", {
                              month: "long",
                              year: "numeric",
                            })}
                          </td>
                          <td className="px-4 py-3 text-blue-700">
                            {peso.format(row.gross_sales)}
                          </td>
                          <td className="px-4 py-3 text-red-600">
                            {peso.format(row.cost)}
                          </td>
                          <td className="px-4 py-3 font-bold text-emerald-700">
                            {peso.format(row.gross_profit)}
                          </td>
                          <td className="px-4 py-3">
                            {number(row.units_sold)}
                          </td>
                        </tr>
                      ))}
                      {data && data.area_trend.length === 0 && (
                        <tr>
                          <td
                            colSpan={5}
                            className="p-10 text-center text-slate-400"
                          >
                            No monthly sales data in this scope.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
                <div className="border-b p-4">
                  <h2 className="font-bold">Area sales breakdown</h2>
                  <p className="text-xs text-slate-500">
                    Use region totals to assess demand before assigning a new
                    Regional or Provincial Distributor
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1150px] text-left text-sm">
                    <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                      <tr>
                        {[
                          "Region",
                          "Province",
                          "City / municipality",
                          "Sellers",
                          "Buyers",
                          "Orders",
                          "Units",
                          "Gross sales",
                          "Cost",
                          "Gross profit",
                          "Receivable",
                        ].map((label) => (
                          <th key={label} className="px-4 py-3">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data?.area_analysis.map((row) => (
                        <tr key={row.key}>
                          <td className="px-4 py-3 font-semibold">
                            {row.region_name || "—"}
                          </td>
                          <td className="px-4 py-3">
                            {row.province_name || "All / not specified"}
                          </td>
                          <td className="px-4 py-3">
                            {row.city_muni_name || "All / not specified"}
                          </td>
                          <td className="px-4 py-3">{row.sellers}</td>
                          <td className="px-4 py-3">{row.buyers}</td>
                          <td className="px-4 py-3">{row.orders}</td>
                          <td className="px-4 py-3">{number(row.units)}</td>
                          <td className="px-4 py-3 font-semibold text-blue-700">
                            {peso.format(row.gross_sales)}
                          </td>
                          <td className="px-4 py-3 text-red-600">
                            {peso.format(row.cost)}
                          </td>
                          <td className="px-4 py-3 font-bold text-emerald-700">
                            {peso.format(row.gross_profit)}
                          </td>
                          <td className="px-4 py-3 text-amber-700">
                            {peso.format(row.receivable)}
                          </td>
                        </tr>
                      ))}
                      {data && data.area_analysis.length === 0 && (
                        <tr>
                          <td
                            colSpan={11}
                            className="p-10 text-center text-slate-400"
                          >
                            No delivered distributor sales in this area and
                            period.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="border-t bg-blue-50 p-4 text-xs text-blue-900">
                  <b>Decision basis:</b> figures include recorded delivered
                  product sales made by distributors registered in the selected
                  area. Admin-direct sales are reported separately in Overview
                  because Admin has no single geographic coverage area.
                </div>
              </section>
            </>
          )}
        </>
      )}
      {tab === "activation" && (
        <>
          <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Metric
              label="Activations / upgrades"
              value={number(activation.activations)}
              note="Financial snapshot records"
              accent="#0D1B3E"
            />
            <Metric
              label="Customer payments"
              value={peso.format(activation.customer_payments || 0)}
              note="Full package payments"
              accent="#2563eb"
            />
            <Metric
              label="Product portion"
              value={peso.format(activation.product_portion || 0)}
              note="Reseller-value allocation"
              accent="#C9A84C"
            />
            <Metric
              label="Product cost"
              value={peso.format(activation.product_cost || 0)}
              note="Frozen acquisition cost"
              accent="#dc2626"
            />
            <Metric
              label="Product profit"
              value={peso.format(activation.product_profit || 0)}
              note="Product portion minus cost"
              accent="#059669"
            />
            <Metric
              label="PIN allocation"
              value={peso.format(activation.pin_allocation || 0)}
              note="Separate digital allocation"
              accent="#7c3aed"
            />
          </section>
          <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
            <div className="border-b p-4">
              <h2 className="font-bold">Activation sales by channel</h2>
              <p className="text-xs text-slate-500">
                PIN allocation is inside the customer package payment—not an
                additional charge
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-left text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                  <tr>
                    {[
                      "Channel",
                      "Count",
                      "Customer payment",
                      "Product portion",
                      "Product cost",
                      "Product profit",
                      "PIN allocation",
                    ].map((label) => (
                      <th key={label} className="px-4 py-3">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data?.activation_breakdown.map((row) => (
                    <tr key={row.channel}>
                      <td className="px-4 py-3 font-semibold capitalize">
                        {row.channel.replaceAll("_", " ")}
                      </td>
                      <td className="px-4 py-3">{row.activations}</td>
                      <td className="px-4 py-3">
                        {peso.format(row.customer_payments)}
                      </td>
                      <td className="px-4 py-3">
                        {peso.format(row.product_portion)}
                      </td>
                      <td className="px-4 py-3 text-red-600">
                        {peso.format(row.product_cost)}
                      </td>
                      <td className="px-4 py-3 text-emerald-700">
                        {peso.format(row.product_profit)}
                      </td>
                      <td className="px-4 py-3 text-violet-700">
                        {peso.format(row.pin_allocation)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {tab === "liquidation" && (
        <>
          <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Gross sales"
              value={peso.format(summary.gross_sales || 0)}
              note="Delivered transactions in selected scope"
              accent="#2563eb"
            />
            <Metric
              label="Cost of goods"
              value={peso.format(summary.cost || 0)}
              note="Snapshot-first costing"
              accent="#dc2626"
            />
            <Metric
              label="Gross profit"
              value={peso.format(summary.gross_profit || 0)}
              note="Gross sales minus cost"
              accent="#059669"
            />
            <Metric
              label="Outstanding receivable"
              value={peso.format(summary.receivable || 0)}
              note={`Collected ${peso.format(summary.collected || 0)}`}
              accent="#d97706"
            />
          </section>
          <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
            <div className="border-b p-4">
              <h2 className="font-bold">Sales liquidation by seller level</h2>
              <p className="text-xs text-slate-500">
                Use Sold by and Sold to filters in Product Movement for a
                specific route or distributor class
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[950px] text-left text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                  <tr>
                    {[
                      "Seller level",
                      "Orders",
                      "Units",
                      "Gross sales",
                      "Cost",
                      "Gross profit",
                      "Collected",
                      "Receivable",
                    ].map((label) => (
                      <th key={label} className="px-4 py-3">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data?.liquidation.map((row) => (
                    <tr key={row.key}>
                      <td className="px-4 py-3 font-bold">{row.label}</td>
                      <td className="px-4 py-3">{row.orders}</td>
                      <td className="px-4 py-3">{row.units}</td>
                      <td className="px-4 py-3 text-blue-700">
                        {peso.format(row.gross_sales)}
                      </td>
                      <td className="px-4 py-3 text-red-600">
                        {peso.format(row.cost)}
                      </td>
                      <td className="px-4 py-3 font-bold text-emerald-700">
                        {peso.format(row.gross_profit)}
                      </td>
                      <td className="px-4 py-3">
                        {peso.format(row.collected)}
                      </td>
                      <td className="px-4 py-3 text-amber-700">
                        {peso.format(row.receivable)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t bg-amber-50 p-4 text-xs text-amber-900">
              <b>Liquidation scope:</b> this is sales liquidation from recorded
              orders. Full opening/closing physical stock reconciliation
              requires every downstream stock transfer to write an immutable
              inventory movement; current code has complete Admin-direct
              movement snapshots but not every historical downstream transfer.
            </div>
          </section>
        </>
      )}
    </main>
  );
}
