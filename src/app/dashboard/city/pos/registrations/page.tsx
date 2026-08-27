"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Intake = {
  id: string;
  receipt_number: string;
  status: string;
  applicant_full_name: string;
  applicant_mobile: string;
  applicant_email: string | null;
  applicant_birthday: string;
  applicant_birthplace: string;
  applicant_address: Record<string, unknown>;
  applicant_snapshot: Record<string, unknown>;
  identity_document_type: string;
  identity_document_reference: string;
  referrer_username: string;
  preferred_position: string | null;
  payment_method_snapshot: string;
  payment_reference: string | null;
  amount: number;
  released_at: string | null;
  package: { name: string };
};

const label: Record<string, string> = {
  pending_payment_verification: "Awaiting payment approval",
  payment_verified_ready_for_release: "Ready for package release",
  released_pending_encoding: "Package released",
  encoding_in_progress: "Account setup in progress",
  registration_completed: "Registration complete",
  needs_correction: "Needs correction",
  payment_rejected: "Payment rejected",
};

const statusClass: Record<string, string> = {
  pending_payment_verification: "border-amber-200 bg-amber-50 text-amber-800",
  payment_verified_ready_for_release:
    "border-emerald-200 bg-emerald-50 text-emerald-800",
  released_pending_encoding: "border-blue-200 bg-blue-50 text-blue-800",
  encoding_in_progress: "border-indigo-200 bg-indigo-50 text-indigo-800",
  registration_completed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  needs_correction: "border-amber-200 bg-amber-50 text-amber-800",
  payment_rejected: "border-red-200 bg-red-50 text-red-700",
};

export default function PosRegistrationsPage() {
  const [rows, setRows] = useState<Intake[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [canEncode, setCanEncode] = useState(false);
  const [reviewing, setReviewing] = useState<Intake | null>(null);

  function field(value: unknown) {
    return typeof value === "string" && value.trim() ? value : "Not provided";
  }

  function address(row: Intake) {
    const value = row.applicant_address || {};
    return [
      value.street_address,
      value.barangay_name,
      value.city_muni_name,
      value.province_name,
      value.region_name,
      value.zip_code,
    ]
      .filter((part) => typeof part === "string" && part.trim())
      .join(", ");
  }

  async function load() {
    const response = await fetch("/api/city/pos/registrations", {
      cache: "no-store",
    });
    const body = await response.text();
    let result: { error?: string; registrations?: Intake[] } = {};
    try {
      result = body ? JSON.parse(body) : {};
    } catch {
      /* handled using the standard message below */
    }
    if (!response.ok)
      throw new Error(result.error || "Unable to load POS registrations.");
    setRows(result.registrations || []);
  }
  useEffect(() => {
    const refresh = () =>
      void load().catch((reason) => setError(reason.message));
    const timer = window.setTimeout(refresh, 0);
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, []);
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => {
        const user = result.user;
        setCanEncode(
          Boolean(
            user && (!user.is_staff || user.permissions?.includes("resellers")),
          ),
        );
      })
      .catch(() => setCanEncode(false));
  }, []);

  async function release(id: string) {
    setBusy(id);
    setError("");
    try {
      const response = await fetch("/api/city/pos/registrations/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Unable to release package.");
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to release package.",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#A97912]">
            Point of Sale
          </p>
          <h1 className="text-2xl font-bold text-[#071638]">
            Registration Center
          </h1>
          <p className="text-sm text-slate-500">
            Track payment verification, package release, and final account
            encoding in one place.
          </p>
        </div>
        <Link
          href="/dashboard/city/pos/new-registration"
          className="rounded-xl bg-[#C9A84C] px-4 py-2.5 text-center text-sm font-bold text-[#071638]"
        >
          + New Registration
        </Link>
      </div>
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <div>
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-slate-400">
            No registrations have been recorded yet.
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map((row) => (
              <article
                key={row.id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                      Applicant
                    </p>
                    <h2 className="mt-1 text-lg font-bold text-[#071638]">
                      {row.applicant_full_name}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {row.applicant_mobile}
                    </p>
                  </div>
                  <span
                    className={`w-fit rounded-full border px-3 py-1.5 text-xs font-bold ${statusClass[row.status] || "border-slate-200 bg-slate-50 text-slate-700"}`}
                  >
                    {label[row.status] || row.status}
                  </span>
                </div>

                <div className="grid gap-px bg-slate-100 sm:grid-cols-3">
                  <div className="min-w-0 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Receipt number
                    </p>
                    <p className="mt-1 break-all text-sm font-semibold text-[#071638]">
                      {row.receipt_number}
                    </p>
                  </div>
                  <div className="min-w-0 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Registration package
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[#071638]">
                      {row.package.name}
                    </p>
                  </div>
                  <div className="min-w-0 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Payment
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[#071638]">
                      {row.payment_method_snapshot} · ₱
                      {row.amount.toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-4 border-t border-slate-100 bg-slate-50/70 p-5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="max-w-2xl">
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#A97912]">
                      Next step
                    </p>
                    {row.status === "pending_payment_verification" && (
                      <p className="mt-1 text-sm leading-6 text-slate-700">
                        <strong>Do not release the package yet.</strong> Wait
                        for an authorized approver to confirm that the payment
                        reached the bank or e-wallet account.
                      </p>
                    )}
                    {row.status === "payment_verified_ready_for_release" && (
                      <p className="mt-1 text-sm leading-6 text-slate-700">
                        <strong>Payment is verified.</strong> Release the
                        package to {row.applicant_full_name}, then record the
                        release.
                      </p>
                    )}
                    {row.status === "released_pending_encoding" && (
                      <p className="mt-1 text-sm leading-6 text-slate-700">
                        <strong>Create the reseller account.</strong> The
                        package has already been released. Complete the final
                        account setup using a verified PIN.
                      </p>
                    )}
                    {row.status === "encoding_in_progress" && (
                      <p className="mt-1 text-sm leading-6 text-slate-700">
                        Continue and complete the applicant&apos;s reseller
                        account setup.
                      </p>
                    )}
                    {row.status === "registration_completed" && (
                      <p className="mt-1 text-sm leading-6 text-slate-700">
                        The reseller account has been created successfully. No
                        further action is required.
                      </p>
                    )}
                    {row.status === "payment_rejected" && (
                      <p className="mt-1 text-sm leading-6 text-red-700">
                        <strong>Do not release the package.</strong> The
                        submitted payment was rejected and must be resolved
                        first.
                      </p>
                    )}
                    {row.status === "needs_correction" && (
                      <p className="mt-1 text-sm leading-6 text-amber-800">
                        <strong>Review the registration details.</strong>{" "}
                        Correct the reported issue before continuing.
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                    {row.status === "payment_verified_ready_for_release" && (
                      <button
                        disabled={busy === row.id}
                        onClick={() => void release(row.id)}
                        className="rounded-xl bg-[#071638] px-5 py-3 text-center text-sm font-bold text-white disabled:opacity-50"
                      >
                        {busy === row.id
                          ? "Recording release..."
                          : "Confirm package release"}
                      </button>
                    )}
                    {[
                      "released_pending_encoding",
                      "encoding_in_progress",
                    ].includes(row.status) &&
                      (canEncode ? (
                        <button
                          type="button"
                          onClick={() => setReviewing(row)}
                          className="rounded-xl bg-[#C9A84C] px-5 py-3 text-center text-sm font-bold text-[#071638]"
                        >
                          Review registration
                        </button>
                      ) : (
                        <span className="max-w-56 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-5 text-slate-500">
                          Waiting for an authorized branch encoder
                        </span>
                      ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {reviewing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#020817]/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="registration-review-title"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setReviewing(null);
          }}
        >
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 bg-[#071638] px-5 py-5 text-white sm:px-7">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#E1BC4C]">
                  Registration review
                </p>
                <h2
                  id="registration-review-title"
                  className="mt-1 text-xl font-bold"
                >
                  Verify applicant details
                </h2>
                <p className="mt-1 text-sm text-slate-300">
                  Compare these captured details with the applicant&apos;s
                  signed form before creating the reseller account.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close registration review"
                onClick={() => setReviewing(null)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-xl hover:bg-white/20"
              >
                ×
              </button>
            </div>

            <div className="overflow-y-auto p-5 sm:p-7">
              <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
                <strong>Package already released.</strong> Review the
                information below carefully. Creating the account remains a
                separate step and requires a verified PIN.
              </div>

              <section>
                <h3 className="text-base font-bold text-[#071638]">
                  Applicant information
                </h3>
                <dl className="mt-3 grid overflow-hidden rounded-xl border border-slate-200 sm:grid-cols-2">
                  {[
                    ["Full name", reviewing.applicant_full_name],
                    ["Mobile number", reviewing.applicant_mobile],
                    ["Email address", reviewing.applicant_email],
                    [
                      "Birthday",
                      new Date(
                        reviewing.applicant_birthday,
                      ).toLocaleDateString(),
                    ],
                    ["Birthplace", reviewing.applicant_birthplace],
                    [
                      "Middle name status",
                      reviewing.applicant_snapshot?.no_middle_name === true
                        ? "Legally has no middle name"
                        : field(reviewing.applicant_snapshot?.middle_name),
                    ],
                    ["Valid ID type", reviewing.identity_document_type],
                    ["ID number", reviewing.identity_document_reference],
                  ].map(([name, value]) => (
                    <div
                      key={String(name)}
                      className="border-b border-slate-100 p-4 last:border-0 sm:[&:nth-last-child(-n+2)]:border-b-0"
                    >
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {String(name)}
                      </dt>
                      <dd className="mt-1 break-words text-sm font-semibold text-[#071638]">
                        {field(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className="mt-6">
                <h3 className="text-base font-bold text-[#071638]">
                  Address and placement
                </h3>
                <dl className="mt-3 grid overflow-hidden rounded-xl border border-slate-200 sm:grid-cols-2">
                  {[
                    ["Complete address", address(reviewing)],
                    [
                      "Direct sponsor full name",
                      reviewing.applicant_snapshot?.referrer_full_name,
                    ],
                    ["Direct sponsor username", reviewing.referrer_username],
                    [
                      "Direct upline full name",
                      reviewing.applicant_snapshot?.upline_full_name,
                    ],
                    [
                      "Direct upline username",
                      reviewing.applicant_snapshot?.upline_username,
                    ],
                    ["Preferred position", reviewing.preferred_position],
                  ].map(([name, value]) => (
                    <div
                      key={String(name)}
                      className="border-b border-slate-100 p-4 last:border-0 sm:[&:nth-last-child(-n+2)]:border-b-0"
                    >
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {String(name)}
                      </dt>
                      <dd className="mt-1 break-words text-sm font-semibold capitalize text-[#071638]">
                        {field(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className="mt-6">
                <h3 className="text-base font-bold text-[#071638]">
                  Registration and payment
                </h3>
                <dl className="mt-3 grid overflow-hidden rounded-xl border border-slate-200 sm:grid-cols-2">
                  {[
                    ["Receipt number", reviewing.receipt_number],
                    ["Package", reviewing.package.name],
                    ["Payment method", reviewing.payment_method_snapshot],
                    [
                      "Amount received",
                      `₱${reviewing.amount.toLocaleString()}`,
                    ],
                    ["Payment reference", reviewing.payment_reference],
                    [
                      "Current status",
                      label[reviewing.status] || reviewing.status,
                    ],
                  ].map(([name, value]) => (
                    <div
                      key={String(name)}
                      className="border-b border-slate-100 p-4 last:border-0 sm:[&:nth-last-child(-n+2)]:border-b-0"
                    >
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {String(name)}
                      </dt>
                      <dd className="mt-1 break-words text-sm font-semibold text-[#071638]">
                        {field(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-7">
              <button
                type="button"
                onClick={() => setReviewing(null)}
                className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-[#071638]"
              >
                Back to registration list
              </button>
              <Link
                href={`/dashboard/city/resellers/register?pos_intake=${reviewing.id}`}
                className="rounded-xl bg-[#C9A84C] px-5 py-3 text-center text-sm font-bold text-[#071638]"
              >
                Details verified — Create reseller account
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
