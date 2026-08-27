"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  deleteQueuedRegistration,
  listQueuedRegistrations,
  permanentReceiptNumber,
  saveQueuedRegistration,
  type PosQueuedRegistration,
  type PosReceiptRange,
} from "@/app/lib/posOfflineQueue";

type Bootstrap = {
  cashier: { full_name: string; username: string };
  terminal: { id: string; receipt_code: string };
  receipt_location_code: string;
  receipt_range: PosReceiptRange;
  open_shift: { id: string } | null;
  catalog: Array<{ product_id: string; name: string; stock: number }>;
  payment_methods: Array<{
    id: string;
    type: string;
    account_name: string;
    account_number?: string;
    bank_name?: string;
  }>;
  registration_packages: Array<{
    id: string;
    name: string;
    total: number;
    products: Array<{ product_id: string; name: string; quantity: number }>;
  }>;
};

type PsgcOption = { code: string; name: string };

const PSGC_API = "https://psgc.gitlab.io/api";
const PSGC_CACHE_PREFIX = "hiroma_pos_psgc_";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(value);
}

function normalizePsgcOptions(value: unknown): PsgcOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const code =
        "code" in row && typeof row.code === "string" ? row.code : "";
      const name =
        "name" in row && typeof row.name === "string" ? row.name : "";
      return code && name ? [{ code, name }] : [];
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function cachedPsgcOptions(key: string): PsgcOption[] {
  try {
    return normalizePsgcOptions(
      JSON.parse(localStorage.getItem(`${PSGC_CACHE_PREFIX}${key}`) || "[]"),
    );
  } catch {
    return [];
  }
}

async function loadPsgcOptions(
  key: string,
  url: string,
): Promise<PsgcOption[]> {
  const cached = cachedPsgcOptions(key);
  if (!navigator.onLine) return cached;
  try {
    const response = await fetch(url);
    if (!response.ok)
      throw new Error("Unable to load official address options.");
    const options = normalizePsgcOptions(await response.json());
    if (options.length > 0)
      localStorage.setItem(
        `${PSGC_CACHE_PREFIX}${key}`,
        JSON.stringify(options),
      );
    return options;
  } catch {
    return cached;
  }
}

const emptyApplicant = {
  first_name: "",
  middle_name: "",
  last_name: "",
  suffix: "",
  no_middle_name: false,
  full_name: "",
  birthday: "",
  birthplace: "",
  mobile: "",
  email: "",
  street_address: "",
  barangay_name: "",
  barangay_code: "",
  city_muni_name: "",
  city_muni_code: "",
  province_name: "",
  province_code: "",
  region_name: "",
  region_code: "",
  zip_code: "",
  referrer_full_name: "",
  referrer_username: "",
  upline_full_name: "",
  upline_username: "",
  preferred_position: "",
  identity_document_type: "",
  identity_document_reference: "",
  notes: "",
};

const validIdTypes = [
  "National ID",
  "Passport",
  "Driver’s License",
  "TIN ID",
  "UMID",
  "PhilHealth ID",
  "Voter’s ID",
  "Postal ID",
  "PRC ID",
] as const;

export default function NewPosRegistrationPage() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [online, setOnline] = useState(true);
  const [applicant, setApplicant] = useState(emptyApplicant);
  const [packageId, setPackageId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [verifiedPackageItems, setVerifiedPackageItems] = useState<
    Record<string, boolean>
  >({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{
    receipt: string;
    offline: boolean;
    status: string;
  } | null>(null);
  const [regions, setRegions] = useState<PsgcOption[]>([]);
  const [provinces, setProvinces] = useState<PsgcOption[]>([]);
  const [cityMunis, setCityMunis] = useState<PsgcOption[]>([]);
  const [barangays, setBarangays] = useState<PsgcOption[]>([]);
  const [loadingAddress, setLoadingAddress] = useState<
    "regions" | "provinces" | "cities" | "barangays" | ""
  >("regions");

  useEffect(() => {
    const update = () => {
      const connected = navigator.onLine;
      setOnline(connected);
      if (!connected) {
        setPaymentMethod("cash");
        setPaymentReference("");
      }
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    let cached: Bootstrap | null = null;
    try {
      cached = JSON.parse(
        localStorage.getItem("hiroma_pos_bootstrap") || "null",
      );
    } catch {
      /* ignore damaged cache */
    }
    if (cached) window.setTimeout(() => setData(cached), 0);
    const installationId = localStorage.getItem("hiroma_pos_installation_id");
    const receiptRange = JSON.parse(
      localStorage.getItem("hiroma_pos_receipt_range") || "null",
    );
    if (navigator.onLine && installationId) {
      fetch("/api/city/pos/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installation_id: installationId,
          name: `POS ${installationId.slice(0, 8).toUpperCase()}`,
          platform: navigator.platform,
          receipt_range: receiptRange,
        }),
      })
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok)
            throw new Error(result.error || "Unable to load POS registration.");
          setData(result);
          localStorage.setItem("hiroma_pos_bootstrap", JSON.stringify(result));
          localStorage.setItem(
            "hiroma_pos_receipt_range",
            JSON.stringify(result.receipt_range),
          );
        })
        .catch((reason) =>
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to load POS registration.",
          ),
        );
    }
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadPsgcOptions("regions", `${PSGC_API}/regions/`).then((options) => {
      if (!cancelled) {
        setRegions(options);
        setLoadingAddress("");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    async function synchronize() {
      const queued = await listQueuedRegistrations();
      for (const row of queued) {
        if (cancelled) return;
        await saveQueuedRegistration({
          ...row,
          status: "syncing",
          error: undefined,
        });
        try {
          const response = await fetch("/api/city/pos/registrations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(row.payload),
          });
          const result = await response.json();
          if (!response.ok)
            throw new Error(
              result.error || "Registration synchronization needs attention.",
            );
          await deleteQueuedRegistration(row.client_intake_id);
        } catch (reason) {
          await saveQueuedRegistration({
            ...row,
            status: "needs_attention",
            error:
              reason instanceof Error
                ? reason.message
                : "Registration synchronization needs attention.",
          });
        }
      }
    }
    void synchronize();
    return () => {
      cancelled = true;
    };
  }, [online]);

  const selectedPackage = useMemo(
    () => data?.registration_packages.find((pkg) => pkg.id === packageId),
    [data, packageId],
  );
  const stockReady = useMemo(
    () =>
      selectedPackage?.products.every((item) => {
        const product = data?.catalog.find(
          (row) => row.product_id === item.product_id,
        );
        return (product?.stock || 0) >= item.quantity;
      }) ?? false,
    [data, selectedPackage],
  );
  const packageStockShortages = useMemo(
    () =>
      selectedPackage?.products.flatMap((item) => {
        const available =
          data?.catalog.find((row) => row.product_id === item.product_id)
            ?.stock ?? 0;
        return available < item.quantity ? [{ ...item, available }] : [];
      }) ?? [],
    [data, selectedPackage],
  );
  const packageItemsVerified = useMemo(
    () =>
      selectedPackage?.products.length
        ? selectedPackage.products.every(
            (item) => verifiedPackageItems[item.product_id] === true,
          )
        : false,
    [selectedPackage, verifiedPackageItems],
  );
  const parsedCashReceived = Number(cashReceived);
  const hasValidCashReceived =
    cashReceived.trim() !== "" &&
    Number.isFinite(parsedCashReceived) &&
    parsedCashReceived >= 0;
  const hasEnoughCash =
    Boolean(selectedPackage) &&
    hasValidCashReceived &&
    parsedCashReceived >= (selectedPackage?.total ?? 0);
  const cashChange = hasEnoughCash
    ? parsedCashReceived - (selectedPackage?.total ?? 0)
    : 0;
  const cashShortfall = selectedPackage
    ? Math.max(
        0,
        selectedPackage.total -
          (hasValidCashReceived ? parsedCashReceived : 0),
      )
    : 0;

  function change(name: keyof typeof emptyApplicant, value: string | boolean) {
    setApplicant((current) => {
      const next = { ...current, [name]: value };
      next.full_name = [
        next.first_name,
        next.no_middle_name ? "" : next.middle_name,
        next.last_name,
        next.suffix,
      ]
        .filter(Boolean)
        .join(" ");
      return next;
    });
  }

  function setNoMiddleName(checked: boolean) {
    setApplicant((current) => {
      const next = {
        ...current,
        no_middle_name: checked,
        middle_name: checked ? "" : current.middle_name,
      };
      next.full_name = [
        next.first_name,
        checked ? "" : next.middle_name,
        next.last_name,
        next.suffix,
      ]
        .filter(Boolean)
        .join(" ");
      return next;
    });
  }

  async function selectRegion(regionCode: string) {
    const region = regions.find((option) => option.code === regionCode);
    setApplicant((current) => ({
      ...current,
      region_code: regionCode,
      region_name: region?.name || "",
      province_code: "",
      province_name: "",
      city_muni_code: "",
      city_muni_name: "",
      barangay_code: "",
      barangay_name: "",
    }));
    setProvinces([]);
    setCityMunis([]);
    setBarangays([]);
    if (!regionCode) return;
    setLoadingAddress("provinces");
    const nextProvinces = await loadPsgcOptions(
      `provinces_${regionCode}`,
      `${PSGC_API}/regions/${regionCode}/provinces/`,
    );
    if (nextProvinces.length > 0) {
      setProvinces(nextProvinces);
      setLoadingAddress("");
      return;
    }
    const directCities = await loadPsgcOptions(
      `cities_region_${regionCode}`,
      `${PSGC_API}/regions/${regionCode}/cities-municipalities/`,
    );
    setApplicant((current) =>
      current.region_code === regionCode
        ? {
            ...current,
            province_code: "DIRECT",
            province_name: "Not applicable",
          }
        : current,
    );
    setCityMunis(directCities);
    setLoadingAddress("");
  }

  async function selectProvince(provinceCode: string) {
    const province = provinces.find((option) => option.code === provinceCode);
    setApplicant((current) => ({
      ...current,
      province_code: provinceCode,
      province_name: province?.name || "",
      city_muni_code: "",
      city_muni_name: "",
      barangay_code: "",
      barangay_name: "",
    }));
    setCityMunis([]);
    setBarangays([]);
    if (!provinceCode) return;
    setLoadingAddress("cities");
    const options = await loadPsgcOptions(
      `cities_province_${provinceCode}`,
      `${PSGC_API}/provinces/${provinceCode}/cities-municipalities/`,
    );
    setCityMunis(options);
    setLoadingAddress("");
  }

  async function selectCityMuni(cityCode: string) {
    const city = cityMunis.find((option) => option.code === cityCode);
    setApplicant((current) => ({
      ...current,
      city_muni_code: cityCode,
      city_muni_name: city?.name || "",
      barangay_code: "",
      barangay_name: "",
    }));
    setBarangays([]);
    if (!cityCode) return;
    setLoadingAddress("barangays");
    const options = await loadPsgcOptions(
      `barangays_${cityCode}`,
      `${PSGC_API}/cities-municipalities/${cityCode}/barangays/`,
    );
    setBarangays(options);
    setLoadingAddress("");
  }

  function selectBarangay(barangayCode: string) {
    const barangay = barangays.find((option) => option.code === barangayCode);
    setApplicant((current) => ({
      ...current,
      barangay_code: barangayCode,
      barangay_name: barangay?.name || "",
    }));
  }

  async function submit() {
    setError("");
    if (!data?.open_shift)
      return setError("Open a cashier shift before accepting a registration.");
    if (!selectedPackage || !stockReady)
      return setError(
        "This registration cannot continue because one or more products in the selected package are not available in the required quantity. Replenish the listed products or choose another package.",
      );
    if (!packageItemsVerified)
      return setError(
        "Verify every physical product and quantity included in the selected package before saving the registration.",
      );
    const requiredFields = [
      ["First name", applicant.first_name],
      ["Middle name", applicant.no_middle_name || applicant.middle_name],
      ["Last name", applicant.last_name],
      ["Birthday", applicant.birthday],
      ["Birthplace", applicant.birthplace],
      ["Mobile", applicant.mobile],
      ["Email", applicant.email],
      ["Street address", applicant.street_address],
      ["Barangay", applicant.barangay_name],
      ["City or municipality", applicant.city_muni_name],
      ["Province", applicant.province_name],
      ["Region", applicant.region_name],
      ["ZIP code", applicant.zip_code],
      ["Direct sponsor full name", applicant.referrer_full_name],
      ["Direct sponsor username", applicant.referrer_username],
      ["Direct upline full name", applicant.upline_full_name],
      ["Direct upline username", applicant.upline_username],
      ["Preferred position", applicant.preferred_position],
      ["Valid ID type", applicant.identity_document_type],
      ["ID number", applicant.identity_document_reference],
    ] as const;
    const missingFields = requiredFields
      .filter(([, value]) => !value)
      .map(([label]) => label);
    if (missingFields.length > 0) {
      return setError(
        `Complete all required fields. Missing: ${missingFields.join(", ")}.`,
      );
    }
    if (!online && paymentMethod !== "cash")
      return setError("Offline registration accepts cash only.");
    if (paymentMethod === "cash" && !hasValidCashReceived)
      return setError("Enter the cash received from the applicant.");
    if (paymentMethod === "cash" && !hasEnoughCash)
      return setError(
        `Cash received is not enough. Add ${formatCurrency(cashShortfall)} more to cover the package total.`,
      );
    if (paymentMethod !== "cash" && !paymentReference.trim())
      return setError("Enter the bank or e-wallet transaction reference.");
    const range = data.receipt_range;
    if (range.next > range.end)
      return setError(
        "This terminal must reconnect to reserve more permanent receipt numbers.",
      );
    setSaving(true);
    try {
      const now = new Date();
      const clientId = crypto.randomUUID();
      const sequence = range.next;
      const receipt = permanentReceiptNumber(
        data.receipt_location_code,
        data.terminal.receipt_code,
        now,
        sequence,
      );
      const nextRange = { ...range, next: sequence + 1 };
      const payload = {
        client_intake_id: clientId,
        receipt_number: receipt,
        terminal_id: data.terminal.id,
        shift_id: data.open_shift.id,
        package_id: selectedPackage.id,
        package_release_verification: selectedPackage.products.map((item) => ({
          product_id: item.product_id,
          name: item.name,
          quantity: item.quantity,
          verified: verifiedPackageItems[item.product_id] === true,
        })),
        applicant: {
          ...applicant,
          identity_document_number: applicant.identity_document_reference,
          address: {
            street_address: applicant.street_address,
            street: applicant.street_address,
            barangay_name: applicant.barangay_name,
            barangay_code: applicant.barangay_code,
            city_muni_name: applicant.city_muni_name,
            city_muni_code: applicant.city_muni_code,
            province_name: applicant.province_name,
            province_code: applicant.province_code,
            region_name: applicant.region_name,
            region_code: applicant.region_code,
            zip_code: applicant.zip_code,
          },
        },
        payment_method: paymentMethod,
        payment_reference:
          paymentMethod === "cash" ? null : paymentReference.trim(),
        captured_offline: !online,
        local_created_at: now.toISOString(),
        notes: applicant.notes,
      };
      localStorage.setItem(
        "hiroma_pos_receipt_range",
        JSON.stringify(nextRange),
      );
      setData((current) =>
        current ? { ...current, receipt_range: nextRange } : current,
      );
      if (!online) {
        const queued: PosQueuedRegistration = {
          client_intake_id: clientId,
          receipt_number: receipt,
          payload,
          status: "saved_offline",
          created_at: now.toISOString(),
        };
        await saveQueuedRegistration(queued);
        const adjusted = {
          ...data,
          receipt_range: nextRange,
          catalog: data.catalog.map((row) => {
            const released = selectedPackage.products.find(
              (item) => item.product_id === row.product_id,
            );
            return released
              ? { ...row, stock: Math.max(0, row.stock - released.quantity) }
              : row;
          }),
        };
        setData(adjusted);
        localStorage.setItem("hiroma_pos_bootstrap", JSON.stringify(adjusted));
        setSuccess({
          receipt,
          offline: true,
          status: "Released · Pending sync and registration encoding",
        });
      } else {
        const response = await fetch("/api/city/pos/registrations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error || "Unable to save registration intake.",
          );
        setSuccess({
          receipt,
          offline: false,
          status: result.registration.status,
        });
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to save registration intake.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (success) {
    const awaitingPayment = success.status === "pending_payment_verification";
    const confirmation = success.offline
      ? {
          title: "Registration saved safely on this device",
          summary:
            "The cash payment and prepared package were recorded. This registration will be sent to Hiroma automatically when the internet connection returns.",
          next: "Keep this receipt number. Final account creation can begin after synchronization.",
        }
      : awaitingPayment
        ? {
            title: "Registration submitted for payment verification",
            summary:
              "The applicant details were saved. An authorized approver must confirm the bank or e-wallet payment before the package can be released.",
            next: "Do not release the package yet. Track its progress in the Registration Center.",
          }
        : {
            title: "Registration details saved successfully",
            summary:
              "The cash payment and package release were recorded. The applicant is now waiting for final account creation by an authorized branch encoder.",
            next: "Next step: open the Registration Center and complete the reseller account using a verified PIN.",
          };

    return (
      <div className="mx-auto max-w-xl p-6">
        <div className="rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
          <div
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700"
            aria-hidden
          >
            ✓
          </div>
          <p className="mt-4 text-xs font-bold uppercase tracking-widest text-emerald-700">
            Registration recorded
          </p>
          <h1 className="mt-2 text-2xl font-bold text-[#071638]">
            {confirmation.title}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-600">
            {confirmation.summary}
          </p>
          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Registration receipt number
            </p>
            <p className="mt-1 break-all text-lg font-bold text-[#071638]">
              {success.receipt}
            </p>
            <p
              className={`mt-3 text-sm font-medium ${awaitingPayment ? "text-amber-700" : "text-emerald-700"}`}
            >
              {confirmation.next}
            </p>
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-2.5">
            <button
              onClick={() => {
                 setApplicant(emptyApplicant);
                 setPackageId("");
                 setCashReceived("");
                 setPaymentReference("");
                 setVerifiedPackageItems({});
                setSuccess(null);
              }}
              className="whitespace-nowrap rounded-lg bg-[#C9A84C] px-4 py-2 text-sm font-semibold text-[#071638]"
            >
              New registration
            </button>
            <Link
              href="/dashboard/city/pos/registrations"
              className="whitespace-nowrap rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-[#071638]"
            >
              Go to Registration Center
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-5 flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#A97912]">
            Point of Sale
          </p>
          <h1 className="text-2xl font-bold text-[#071638]">
            New Reseller Registration Intake
          </h1>
          <p className="text-sm text-slate-500">
            Cashier captures and receives. Account creation remains a separate
            reviewed encoding step.
          </p>
        </div>
        <div
          className={`rounded-full px-3 py-1 text-sm font-semibold ${online ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
        >
          {online ? "Online" : "Offline · Cash only"}
        </div>
      </div>
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 font-bold text-[#071638]">
            Applicant information
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {(
              [
                "first_name",
                "middle_name",
                "last_name",
                "suffix",
                "birthday",
                "birthplace",
                "mobile",
                "email",
              ] as const
            ).map((name) => {
              const optional = name === "suffix";
              const middleNameDisabled =
                name === "middle_name" && applicant.no_middle_name;
              return (
                <div key={name}>
                  <label className="text-xs font-semibold capitalize text-slate-600">
                    {name.replaceAll("_", " ")}{" "}
                    {optional ? (
                      <span className="font-normal text-slate-400">
                        (optional)
                      </span>
                    ) : (
                      <span className="text-red-600">*</span>
                    )}
                    <input
                      required={!optional && !middleNameDisabled}
                      disabled={middleNameDisabled}
                      type={
                        name === "birthday"
                          ? "date"
                          : name === "email"
                            ? "email"
                            : "text"
                      }
                      value={String(applicant[name])}
                      onChange={(event) => change(name, event.target.value)}
                      placeholder={
                        middleNameDisabled ? "Not applicable" : undefined
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal text-[#071638] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </label>
                  {name === "middle_name" && (
                    <label className="mt-2 flex items-center gap-2 text-xs font-normal text-slate-600">
                      <input
                        type="checkbox"
                        checked={applicant.no_middle_name}
                        onChange={(event) =>
                          setNoMiddleName(event.target.checked)
                        }
                      />
                      Legally has no middle name
                    </label>
                  )}
                </div>
              );
            })}
            <label className="text-xs font-semibold text-slate-600">
              Valid ID type <span className="text-red-600">*</span>
              <select
                required
                value={applicant.identity_document_type}
                onChange={(event) =>
                  change("identity_document_type", event.target.value)
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-[#071638]"
              >
                <option value="">Select valid ID</option>
                {validIdTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600">
              ID number <span className="text-red-600">*</span>
              <input
                required
                value={applicant.identity_document_reference}
                onChange={(event) =>
                  change("identity_document_reference", event.target.value)
                }
                placeholder="Enter ID number"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal text-[#071638]"
              />
              <span className="mt-1 block text-[11px] font-normal text-slate-400">
                Used for identity review and duplicate-account protection.
              </span>
            </label>
          </div>
          <h3 className="mb-3 mt-6 font-semibold">Complete address</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {regions.length > 0 || online ? (
              <label className="text-xs font-semibold text-slate-600">
                Region <span className="text-red-600">*</span>
                <select
                  required
                  value={applicant.region_code}
                  onChange={(event) => void selectRegion(event.target.value)}
                  disabled={loadingAddress === "regions"}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-[#071638] disabled:bg-slate-100"
                >
                  <option value="">
                    {loadingAddress === "regions"
                      ? "Loading regions…"
                      : "Select region"}
                  </option>
                  {regions.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="text-xs font-semibold text-slate-600">
                Region <span className="text-red-600">*</span>
                <input
                  required
                  value={applicant.region_name}
                  onChange={(event) =>
                    change("region_name", event.target.value)
                  }
                  placeholder="Enter region while offline"
                  className="mt-1 w-full rounded-lg border border-amber-300 px-3 py-2.5 text-sm font-normal text-[#071638]"
                />
              </label>
            )}

            {applicant.province_code === "DIRECT" ? (
              <label className="text-xs font-semibold text-slate-600">
                Province <span className="text-red-600">*</span>
                <input
                  readOnly
                  value="Not applicable for this region"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2.5 text-sm font-normal text-slate-500"
                />
              </label>
            ) : provinces.length > 0 || online ? (
              <label className="text-xs font-semibold text-slate-600">
                Province <span className="text-red-600">*</span>
                <select
                  required
                  value={applicant.province_code}
                  onChange={(event) => void selectProvince(event.target.value)}
                  disabled={
                    !applicant.region_code || loadingAddress === "provinces"
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-[#071638] disabled:bg-slate-100"
                >
                  <option value="">
                    {loadingAddress === "provinces"
                      ? "Loading provinces…"
                      : "Select province"}
                  </option>
                  {provinces.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="text-xs font-semibold text-slate-600">
                Province <span className="text-red-600">*</span>
                <input
                  required
                  value={applicant.province_name}
                  onChange={(event) =>
                    change("province_name", event.target.value)
                  }
                  placeholder="Enter province while offline"
                  className="mt-1 w-full rounded-lg border border-amber-300 px-3 py-2.5 text-sm font-normal text-[#071638]"
                />
              </label>
            )}

            {cityMunis.length > 0 || online ? (
              <label className="text-xs font-semibold text-slate-600">
                City / Municipality <span className="text-red-600">*</span>
                <select
                  required
                  value={applicant.city_muni_code}
                  onChange={(event) => void selectCityMuni(event.target.value)}
                  disabled={
                    (!applicant.province_code &&
                      applicant.region_code !== "") ||
                    loadingAddress === "cities" ||
                    !applicant.region_code
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-[#071638] disabled:bg-slate-100"
                >
                  <option value="">
                    {loadingAddress === "cities"
                      ? "Loading cities and municipalities…"
                      : "Select city or municipality"}
                  </option>
                  {cityMunis.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="text-xs font-semibold text-slate-600">
                City / Municipality <span className="text-red-600">*</span>
                <input
                  required
                  value={applicant.city_muni_name}
                  onChange={(event) =>
                    change("city_muni_name", event.target.value)
                  }
                  placeholder="Enter city or municipality while offline"
                  className="mt-1 w-full rounded-lg border border-amber-300 px-3 py-2.5 text-sm font-normal text-[#071638]"
                />
              </label>
            )}

            {barangays.length > 0 || online ? (
              <label className="text-xs font-semibold text-slate-600">
                Barangay <span className="text-red-600">*</span>
                <select
                  required
                  value={applicant.barangay_code}
                  onChange={(event) => selectBarangay(event.target.value)}
                  disabled={
                    !applicant.city_muni_code || loadingAddress === "barangays"
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-[#071638] disabled:bg-slate-100"
                >
                  <option value="">
                    {loadingAddress === "barangays"
                      ? "Loading barangays…"
                      : "Select barangay"}
                  </option>
                  {barangays.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="text-xs font-semibold text-slate-600">
                Barangay <span className="text-red-600">*</span>
                <input
                  required
                  value={applicant.barangay_name}
                  onChange={(event) =>
                    change("barangay_name", event.target.value)
                  }
                  placeholder="Enter barangay while offline"
                  className="mt-1 w-full rounded-lg border border-amber-300 px-3 py-2.5 text-sm font-normal text-[#071638]"
                />
              </label>
            )}

            <label className="text-xs font-semibold text-slate-600">
              Street address <span className="text-red-600">*</span>
              <input
                required
                value={applicant.street_address}
                onChange={(event) =>
                  change("street_address", event.target.value)
                }
                placeholder="House no., street, subdivision or sitio"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal text-[#071638]"
              />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              ZIP code <span className="text-red-600">*</span>
              <input
                required
                inputMode="numeric"
                value={applicant.zip_code}
                onChange={(event) =>
                  change(
                    "zip_code",
                    event.target.value.replace(/\D/g, "").slice(0, 4),
                  )
                }
                placeholder="4-digit ZIP code"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal text-[#071638]"
              />
            </label>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Official PSGC locations are selected in order and their codes are
            saved automatically. Previously loaded choices remain available
            offline; manual offline entries require verification during final
            account encoding.
          </p>
          <h3 className="mb-1 mt-6 font-semibold">
            Referral and binary placement
          </h3>
          <p className="mb-3 text-xs text-slate-500">
            Record both the full name and username shown on the sponsor and
            upline accounts. The direct sponsor receives referral credit, while
            the direct upline and side determine the applicant&apos;s Binary
            Tree placement.
          </p>
          <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-2">
            <label className="text-xs font-semibold text-slate-600">
              Direct sponsor full name <span className="text-red-600">*</span>
              <input
                required
                value={applicant.referrer_full_name}
                onChange={(event) =>
                  change("referrer_full_name", event.target.value)
                }
                placeholder="Full name shown on the sponsor account"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-[#071638]"
              />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Direct sponsor username <span className="text-red-600">*</span>
              <input
                required
                value={applicant.referrer_username}
                onChange={(event) =>
                  change("referrer_username", event.target.value)
                }
                placeholder="Sponsor username"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-[#071638]"
              />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Direct upline full name <span className="text-red-600">*</span>
              <input
                required
                value={applicant.upline_full_name}
                onChange={(event) =>
                  change("upline_full_name", event.target.value)
                }
                placeholder="Full name shown on the upline account"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-[#071638]"
              />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Direct upline username <span className="text-red-600">*</span>
              <input
                required
                value={applicant.upline_username}
                onChange={(event) =>
                  change("upline_username", event.target.value)
                }
                placeholder="Placement parent username"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-[#071638]"
              />
            </label>
            <label className="text-xs font-semibold text-slate-600 md:col-span-2">
              Preferred position <span className="text-red-600">*</span>
              <select
                required
                value={applicant.preferred_position}
                onChange={(event) =>
                  change("preferred_position", event.target.value)
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-[#071638]"
              >
                <option value="">Choose Left or Right</option>
                <option value="left">Left</option>
                <option value="right">Right</option>
              </select>
            </label>
          </div>
        </section>
        <aside className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-bold text-[#071638]">Package and payment</h2>
          <label className="mt-4 block text-xs font-semibold text-slate-600">
            Registration package
            <select
              value={packageId}
              onChange={(event) => {
                 setPackageId(event.target.value);
                 setCashReceived("");
                 setVerifiedPackageItems({});
                setError("");
              }}
              disabled={!data?.registration_packages.length}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm disabled:bg-slate-100"
            >
              <option value="">
                {data && data.registration_packages.length === 0
                  ? "No active packages available"
                  : "Choose package"}
              </option>
              {data?.registration_packages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {pkg.name} · ₱{pkg.total.toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          {selectedPackage && (
            <>
              {stockReady ? (
                <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
                  All products in this package are available at this location.
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <p className="font-bold">
                    This package cannot be released yet.
                  </p>
                  <p className="mt-1 text-xs">
                    Replenish the following product stock or choose another
                    package:
                  </p>
                  <ul className="mt-2 space-y-1 text-xs">
                    {packageStockShortages.map((item) => (
                      <li key={item.product_id}>
                        <strong>{item.name}</strong>: requires {item.quantity},
                        only {item.available} available
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
                <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs font-bold text-[#071638]">
                    Verify package contents
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Check each item only after its full quantity is physically
                    prepared.
                  </p>
                </div>
                <div className="divide-y divide-slate-100">
                  {selectedPackage.products.map((item) => {
                    const available =
                      data?.catalog.find(
                        (row) => row.product_id === item.product_id,
                      )?.stock ?? 0;
                    const itemAvailable = available >= item.quantity;
                    return (
                      <label
                        key={item.product_id}
                        className={`flex items-center gap-3 px-3 py-3 ${!itemAvailable ? "cursor-not-allowed bg-red-50" : verifiedPackageItems[item.product_id] ? "cursor-pointer bg-emerald-50" : "cursor-pointer bg-white"}`}
                      >
                        <input
                          type="checkbox"
                          disabled={!itemAvailable}
                          checked={
                            verifiedPackageItems[item.product_id] === true
                          }
                          onChange={(event) =>
                            setVerifiedPackageItems((current) => ({
                              ...current,
                              [item.product_id]: event.target.checked,
                            }))
                          }
                          className="h-4 w-4 accent-emerald-600"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-[#071638]">
                            {item.name}
                          </span>
                          <span className="text-xs text-slate-500">
                            Required: <strong>{item.quantity}</strong> ·
                            Available: <strong>{available}</strong>
                          </span>
                        </span>
                        <span
                          className={`text-xs font-bold ${verifiedPackageItems[item.product_id] ? "text-emerald-700" : "text-amber-700"}`}
                        >
                          {!itemAvailable
                            ? "Insufficient stock"
                            : verifiedPackageItems[item.product_id]
                              ? "Verified"
                              : "Not checked"}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div
                  className={`border-t px-3 py-2 text-xs font-semibold ${packageItemsVerified ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}
                >
                  {!stockReady
                    ? "Verification is locked until all required products are in stock."
                    : packageItemsVerified
                      ? "All package items are physically verified."
                      : `${selectedPackage.products.filter((item) => !verifiedPackageItems[item.product_id]).length} item(s) still need verification.`}
                </div>
              </div>
            </>
          )}
          <label className="mt-4 block text-xs font-semibold text-slate-600">
            Payment method
            <select
              value={paymentMethod}
              onChange={(event) => {
                const method = event.target.value;
                setPaymentMethod(method);
                setPaymentReference("");
                setCashReceived("");
                setError("");
              }}
              disabled={!online}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
            >
              <option value="cash">Cash</option>
              {online &&
                data?.payment_methods
                  .filter((item) => item.id !== "cash")
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {[
                        item.type.toUpperCase(),
                        item.bank_name,
                        item.account_name,
                        item.account_number,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </option>
                  ))}
            </select>
          </label>
          {paymentMethod === "cash" && selectedPackage && (
            <div className="mt-3 space-y-2">
              <label className="block text-xs font-semibold text-slate-600">
                Cash received <span className="text-red-600">*</span>
                <div className="relative mt-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                    ₱
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={cashReceived}
                    onChange={(event) => {
                      setCashReceived(event.target.value);
                      setError("");
                    }}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-slate-300 py-2.5 pl-8 pr-3 text-sm"
                  />
                </div>
              </label>
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className="font-medium text-slate-600">Change</span>
                <span
                  className={`font-bold ${hasEnoughCash ? "text-emerald-700" : "text-slate-400"}`}
                >
                  {formatCurrency(cashChange)}
                </span>
              </div>
              {hasValidCashReceived && !hasEnoughCash && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                  Cash received is short by {formatCurrency(cashShortfall)}.
                </p>
              )}
            </div>
          )}
          {paymentMethod !== "cash" && (
            <label className="mt-3 block text-xs font-semibold text-slate-600">
              Transaction reference
              <input
                value={paymentReference}
                onChange={(event) => setPaymentReference(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
              />
            </label>
          )}
          <div className="mt-5 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            Cash: package may be released immediately. Bank/e-wallet: do not
            release until an independent approver verifies actual receipt.
          </div>
          <button
            disabled={
              saving ||
              !data ||
               !selectedPackage ||
               !stockReady ||
               (paymentMethod === "cash" && !hasEnoughCash) ||
               Boolean(selectedPackage && !packageItemsVerified)
            }
            onClick={() => void submit()}
            className="mt-5 w-full rounded-xl bg-[#C9A84C] px-4 py-3 font-bold text-[#071638] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving
              ? "Saving…"
              : selectedPackage && !stockReady
                ? "Package unavailable"
                : "Save registration"}
          </button>
        </aside>
      </div>
    </div>
  );
}
