"use client";
import { useEffect, useState } from "react";
import { listQueuedSales } from "@/app/lib/posOfflineQueue";
type D = {
  branch_closing: {
    required: boolean;
    inventory: Array<{ product_id: string; product_name: string }>;
  };
  server_sync_complete: boolean;
  pending_sync_count: number;
};
type R = { counted: string; damaged: string; expired: string };
type CloseOutcome = {
  pending_approval?: boolean;
  reconciliation?: {
    cash_matched: boolean;
    inventory_matched: boolean;
    has_variance: boolean;
  };
};
export default function PosCloseShiftModal(p: {
  open: boolean;
  shiftId: string | null;
  onClose: () => void;
  onCompleted?: () => void | Promise<void>;
}) {
  const [d, setD] = useState<D | null>(null),
    [rows, setRows] = useState<Record<string, R>>({}),
    [cash, setCash] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [online, setOnline] = useState(true),
    [queued, setQueued] = useState(0),
    [recount, setRecount] = useState(false),
    [cm, setCm] = useState(false),
    [im, setIm] = useState(false),
    [cn, setCn] = useState(""),
    [inote, setInote] = useState(""),
    [done, setDone] = useState(false),
    [outcome, setOutcome] = useState<CloseOutcome | null>(null);
  useEffect(() => {
    if (!p.open || !p.shiftId) return;
    let stop = false;
    const net = () => setOnline(navigator.onLine);
    net();
    addEventListener("online", net);
    addEventListener("offline", net);
    // Reset every field whenever a fresh close-shift workflow is opened.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(true);
    setD(null);
    setDone(false);
    setOutcome(null);
    setError("");
    setCash("");
    setRecount(false);
    setCm(false);
    setIm(false);
    setCn("");
    setInote("");
    Promise.all([
      fetch(
        `/api/city/pos/transactions?shift_id=${encodeURIComponent(p.shiftId)}`,
        { cache: "no-store" },
      ).then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw Error(b.error || "Unable to prepare shift closing.");
        return b as D;
      }),
      listQueuedSales(),
    ])
      .then(([x, q]) => {
        if (stop) return;
        setD(x);
        setQueued(q.length);
        setRows(
          Object.fromEntries(
            x.branch_closing.inventory.map((i) => [
              i.product_id,
              { counted: "", damaged: "0", expired: "0" },
            ]),
          ),
        );
      })
      .catch((e) => !stop && setError(e.message))
      .finally(() => !stop && setBusy(false));
    return () => {
      stop = true;
      removeEventListener("online", net);
      removeEventListener("offline", net);
    };
  }, [p.open, p.shiftId]);
  const inventoryOk =
    !d?.branch_closing.required ||
    d.branch_closing.inventory.every((i) => {
      const r = rows[i.product_id];
      if (!r || r.counted === "") return false;
      const a = [+r.counted, +r.damaged, +r.expired];
      return (
        a.every(Number.isInteger) &&
        a.every((n) => n >= 0) &&
        a[1] + a[2] <= a[0]
      );
    });
  const notesOk =
    !recount ||
    ((!cm || cn.trim().length >= 5) && (!im || inote.trim().length >= 5));
  const ready = !!(
    d &&
    online &&
    !queued &&
    d.server_sync_complete &&
    cash !== "" &&
    +cash >= 0 &&
    inventoryOk &&
    notesOk
  );
  async function submit() {
    if (!ready || !p.shiftId || !d) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/city/pos/shifts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shift_id: p.shiftId,
          counted_cash: +cash,
          recount_confirmed: recount,
          cash_explanation: cn,
          inventory_explanation: inote,
          inventory_counts: d.branch_closing.required
            ? d.branch_closing.inventory.map((i) => ({
                product_id: i.product_id,
                counted_quantity: rows[i.product_id].counted,
                damaged_quantity: rows[i.product_id].damaged,
                expired_quantity: rows[i.product_id].expired,
              }))
            : undefined,
        }),
      });
      const b = await r.json();
      if (!r.ok) {
        if (
          b.code === "SHIFT_RECOUNT_REQUIRED" ||
          b.code === "SHIFT_EXPLANATION_REQUIRED"
        ) {
          setRecount(true);
          setCm(
            !!(b.mismatch_categories?.cash || b.required_explanations?.cash),
          );
          setIm(
            !!(
              b.mismatch_categories?.inventory ||
              b.required_explanations?.inventory
            ),
          );
          return;
        }
        throw Error(b.error || "Unable to close shift.");
      }
      setOutcome(b as CloseOutcome);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to close shift.");
    } finally {
      setBusy(false);
    }
  }
  async function finish() {
    p.onClose();
    await p.onCompleted?.();
  }
  if (!p.open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-[#071638]/70 p-3"
      role="dialog"
      aria-modal="true"
    >
      <section className="my-auto w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex justify-between gap-4 bg-[#071638] p-6 text-white">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#d4af45]">
              End-of-shift reconciliation
            </p>
            <h2 className="mt-2 text-2xl font-bold">Close cashier shift</h2>
            <p className="mt-1 text-sm text-white/65">
              Count drawer cash and every physical product. Expected values stay
              hidden for an honest blind count.
            </p>
          </div>
          <button
            onClick={p.onClose}
            aria-label="Close"
            className="h-10 rounded-full bg-white/10 px-4"
          >
            X
          </button>
        </header>
        {busy && !d ? (
          <p className="p-10 text-center text-gray-500">
            Preparing current shift...
          </p>
        ) : done ? (
          <div className="p-8">
            {outcome?.reconciliation && !outcome.reconciliation.has_variance ? (
              <div className="pos-success-panel rounded-2xl border border-emerald-300 bg-emerald-50 p-6">
                <h3 className="text-xl font-bold text-emerald-900">
                  Cash and inventory counts matched
                </h3>
                <p className="mt-2 text-sm text-emerald-800">
                  Your drawer cash and physical product counts match the system
                  records. Great work—keep maintaining accurate counts every
                  shift.
                </p>
                {outcome.pending_approval && (
                  <p className="mt-3 text-sm font-semibold text-emerald-900">
                    Submitted safely and waiting for independent manager
                    confirmation.
                  </p>
                )}
              </div>
            ) : outcome?.reconciliation?.has_variance ? (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6">
                <h3 className="text-xl font-bold text-amber-950">
                  Counts submitted for review
                </h3>
                <p className="mt-2 text-sm text-amber-900">
                  A difference remains in the final count. Your explanation and
                  counts are safely recorded and waiting for independent manager
                  review.
                </p>
              </div>
            ) : (
              <div className="pos-success-panel rounded-2xl border border-emerald-300 bg-emerald-50 p-6">
                <h3 className="text-xl font-bold text-emerald-900">
                  Shift closed successfully
                </h3>
                <p className="mt-2 text-sm text-emerald-800">
                  Your cash count was recorded and the shift has been finalized
                  safely.
                </p>
              </div>
            )}
            <button
              onClick={finish}
              className="mt-5 float-right rounded-xl bg-[#071638] px-5 py-3 font-bold text-white"
            >
              Done
            </button>
            <div className="clear-both" />
          </div>
        ) : d ? (
          <div className="max-h-[72vh] overflow-y-auto p-6">
            {(!online || queued > 0 || !d.server_sync_complete) && (
              <p className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
                Closing is locked until online and fully synchronized. Pending
                on device: {queued}; pending on server: {d.pending_sync_count}.
              </p>
            )}
            {error && (
              <p className="mb-5 rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-700">
                {error}
              </p>
            )}
            {recount && (
              <div className="mb-5 rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-900">
                A difference was detected. Recount the marked cash or inventory
                values; expected values remain hidden.
              </div>
            )}
            <label className="block text-sm font-bold">
              Physical cash in drawer *
              <div className="mt-2 flex rounded-xl border bg-[#f7f8fb] px-4">
                <span className="py-3">&#8369;</span>
                <input
                  type="number"
                  min="0"
                  step=".01"
                  value={cash}
                  onChange={(e) => setCash(e.target.value)}
                  className="w-full bg-transparent px-3 py-3 text-lg font-bold outline-none"
                />
              </div>
              <small className="mt-2 block font-normal text-gray-500">
                Include opening cash and all physical cash currently in the
                drawer.
              </small>
            </label>
            {d.branch_closing.required && (
              <div className="mt-6 overflow-hidden rounded-2xl border">
                <div className="border-b bg-[#f7f8fb] p-4">
                  <b>Blind physical inventory count</b>
                  <p className="text-xs text-gray-500">
                    Expected quantities stay hidden.
                  </p>
                </div>
                {d.branch_closing.inventory.map((i) => {
                  const r = rows[i.product_id] || {
                    counted: "",
                    damaged: "0",
                    expired: "0",
                  };
                  return (
                    <div
                      key={i.product_id}
                      className="grid gap-3 border-b p-4 sm:grid-cols-[1fr_130px_110px_110px]"
                    >
                      <b className="self-center text-sm">{i.product_name}</b>
                      {(
                        [
                          ["counted", "Physical count *"],
                          ["damaged", "Damaged"],
                          ["expired", "Expired"],
                        ] as const
                      ).map(([f, l]) => (
                        <label key={f} className="text-xs font-bold">
                          {l}
                          <input
                            type="number"
                            min="0"
                            value={r[f]}
                            onChange={(e) =>
                              setRows((x) => ({
                                ...x,
                                [i.product_id]: {
                                  ...(x[i.product_id] || r),
                                  [f]: e.target.value,
                                },
                              }))
                            }
                            className="mt-1 w-full rounded-lg border p-2 text-center"
                          />
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
            {recount && (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {cm && (
                  <label className="text-sm font-bold">
                    Cash recount explanation *
                    <textarea
                      value={cn}
                      onChange={(e) => setCn(e.target.value)}
                      className="mt-2 w-full rounded-xl border p-3 font-normal"
                    />
                  </label>
                )}
                {im && (
                  <label className="text-sm font-bold">
                    Inventory recount explanation *
                    <textarea
                      value={inote}
                      onChange={(e) => setInote(e.target.value)}
                      className="mt-2 w-full rounded-xl border p-3 font-normal"
                    />
                  </label>
                )}
              </div>
            )}
            <div className="mt-6 flex justify-end gap-2 border-t pt-5">
              <button
                onClick={p.onClose}
                className="rounded-xl border px-5 py-3 font-bold"
              >
                Cancel
              </button>
              <button
                disabled={!ready || busy}
                onClick={submit}
                className="rounded-xl bg-[#d4af45] px-5 py-3 font-bold text-[#071638] disabled:opacity-40"
              >
                {busy
                  ? "Submitting safely..."
                  : d.branch_closing.required
                    ? "Submit Counts for Approval"
                    : "Confirm & Close Shift"}
              </button>
            </div>
          </div>
        ) : (
          <p className="m-6 rounded-xl bg-red-50 p-4 text-red-700">
            {error || "Unable to prepare shift closing."}
          </p>
        )}
      </section>
    </div>
  );
}
