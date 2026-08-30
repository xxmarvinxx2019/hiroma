"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import PosInstallControl from "@/app/components/pos/PosInstallControl";
import PosCloseShiftModal from "@/app/components/pos/PosCloseShiftModal";
import { loadPosDeviceSettings } from "@/app/lib/posDeviceSettings";
import {
  deleteQueuedSale,
  listQueuedSales,
  loadPosBootstrap,
  permanentReceiptNumber,
  PosQueuedSale,
  PosReceiptRange,
  savePosBootstrap,
  saveQueuedSale,
} from "@/app/lib/posOfflineQueue";

type Bootstrap = {
  cashier: {
    id: string;
    full_name: string;
    username: string;
    staff_type: string;
  };
  terminal: { id: string; name: string; receipt_code: string };
  receipt_location_code: string;
  receipt_range: PosReceiptRange;
  receipt_outlet_name?: string;
  receipt_address?: string;
  receipt_address_source?: "physical_outlet" | "registered_address";
  location: {
    id: string;
    full_name: string;
    distributor_profile?: {
      dist_level: string;
      fulfillment_outlet_name?: string | null;
    } | null;
  } | null;
  catalog: Array<{
    product_id: string;
    barcode: string | null;
    name: string;
    type: string;
    stock: number;
    reseller_price: number;
    srp_price: number;
    pu_value: number;
  }>;
  payment_methods: Array<{
    id: string;
    type: string;
    account_name: string;
    account_number?: string;
    bank_name?: string | null;
  }>;
  open_shift: { id: string; opened_at: string; opening_cash?: number } | null;
  blocking_shift: {
    id: string;
    status: "locally_closed" | "needs_review";
    opened_at: string;
    closing_submitted_at: string | null;
    closing_explanation: string | null;
  } | null;
};

type Member = {
  id: string;
  member_id: string | null;
  username: string;
  full_name: string;
};
type CustomerType = "member" | "non_member";

function extractMemberIdFromQr(value: string) {
  try {
    return (
      decodeURIComponent(value)
        .trim()
        .toUpperCase()
        .match(/HRM-\d{4}-\d{6}/)?.[0] || ""
    );
  } catch {
    return "";
  }
}

function PosMemberQrScanner({
  onClose,
  onVerified,
}: {
  onClose: () => void;
  onVerified: (member: Member, scanProof: string) => void;
}) {
  const scannerElementId = `pos-member-qr-${useId().replace(/:/g, "-")}`;
  const detectionLocked = useRef(false);
  const [scannerError, setScannerError] = useState("");

  useEffect(() => {
    let disposed = false;
    let scanner: import("html5-qrcode").Html5Qrcode | null = null;

    async function verifyMember(decodedText: string) {
      const memberId = extractMemberIdFromQr(decodedText);
      if (!memberId) {
        setScannerError("This is not a valid Hiroma Digital ID QR code.");
        return false;
      }
      try {
        const response = await fetch(
          `/api/city/orders/reseller-orders?member_id=${encodeURIComponent(memberId)}`,
          { cache: "no-store" },
        );
        const result = await response.json();
        if (!response.ok || !result.reseller || !result.scan_proof) {
          throw new Error(
            result.error || "The reseller could not be verified.",
          );
        }
        onVerified(result.reseller as Member, String(result.scan_proof));
        return true;
      } catch (reason) {
        setScannerError(
          reason instanceof Error
            ? reason.message
            : "The reseller could not be verified.",
        );
        return false;
      }
    }

    async function startScanner() {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (disposed) return;
        scanner = new Html5Qrcode(scannerElementId);
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1 },
          async (decodedText) => {
            if (detectionLocked.current) return;
            detectionLocked.current = true;
            setScannerError("");
            const accepted = await verifyMember(decodedText);
            if (!accepted) detectionLocked.current = false;
          },
          () => undefined,
        );
      } catch {
        if (!disposed)
          setScannerError(
            "Camera unavailable. Allow camera access and try again.",
          );
      }
    }

    void startScanner();
    return () => {
      disposed = true;
      if (scanner?.isScanning)
        void scanner
          .stop()
          .then(() => scanner?.clear())
          .catch(() => undefined);
      else scanner?.clear();
    };
  }, [onVerified, scannerElementId]);

  return (
    <div
      className="fixed inset-0 z-[90] bg-[#010521]/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pos-member-scanner-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        aria-label="Close Digital ID scanner"
      />
      <section className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-y-auto bg-white shadow-[-24px_0_70px_rgba(1,5,33,.3)]">
        <header className="flex items-start justify-between border-b px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#b98a16]">
              Secure member verification
            </p>
            <h2
              id="pos-member-scanner-title"
              className="mt-1 text-xl font-bold text-[#071638]"
            >
              Scan Digital ID QR
            </h2>
            <p className="mt-1 text-sm leading-6 text-gray-500">
              Ask the reseller to show the QR code from their Hiroma Digital ID.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
            aria-label="Close scanner"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 space-y-4 p-5">
          <div className="overflow-hidden rounded-2xl border border-[#d4af45]/50 bg-[#010521] p-2">
            <div
              id={scannerElementId}
              className="min-h-[310px] overflow-hidden rounded-xl"
            />
          </div>
          <p className="rounded-xl bg-blue-50 p-3 text-sm leading-6 text-blue-900">
            Member pricing unlocks only after a valid, active Digital ID is
            scanned. The verification is single-use and expires shortly.
          </p>
          {scannerError ? (
            <p
              className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700"
              role="alert"
            >
              {scannerError}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function PosProductScanner({
  onClose,
  onDetected,
}: {
  onClose: () => void;
  onDetected: (barcode: string) => boolean;
}) {
  const scannerElementId = `pos-product-code-${useId().replace(/:/g, "-")}`;
  const detectionLocked = useRef(false);
  const [scannerError, setScannerError] = useState("");
  useEffect(() => {
    let disposed = false;
    let scanner: import("html5-qrcode").Html5Qrcode | null = null;
    async function start() {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (disposed) return;
        scanner = new Html5Qrcode(scannerElementId);
        await scanner.start(
          { facingMode: "environment" },
          { fps: 12, qrbox: { width: 280, height: 180 } },
          (decodedText) => {
            if (detectionLocked.current) return;
            detectionLocked.current = true;
            const accepted = onDetected(decodedText.trim().toUpperCase());
            if (!accepted) {
              setScannerError("No active product matches this barcode.");
              detectionLocked.current = false;
            }
          },
          () => undefined,
        );
      } catch {
        if (!disposed)
          setScannerError(
            "Camera unavailable. Use a USB/Bluetooth barcode scanner or enter the code below.",
          );
      }
    }
    void start();
    return () => {
      disposed = true;
      if (scanner?.isScanning)
        void scanner
          .stop()
          .then(() => scanner?.clear())
          .catch(() => undefined);
      else scanner?.clear();
    };
  }, [onDetected, scannerElementId]);
  return (
    <div
      className="fixed inset-0 z-[90] bg-[#010521]/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pos-product-scanner-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        aria-label="Close product scanner"
      />
      <section className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-[-24px_0_70px_rgba(1,5,33,.3)]">
        <header className="flex items-start justify-between border-b p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#b98a16]">
              Fast checkout
            </p>
            <h2
              id="pos-product-scanner-title"
              className="mt-1 text-xl font-bold text-[#071638]"
            >
              Scan product barcode
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              The matched product is added to the cart using its official POS
              price.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
          >
            ✕
          </button>
        </header>
        <div className="space-y-4 p-5">
          <div className="overflow-hidden rounded-2xl border border-[#d4af45]/50 bg-[#010521] p-2">
            <div
              id={scannerElementId}
              className="min-h-[300px] overflow-hidden rounded-xl"
            />
          </div>
          {scannerError ? (
            <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
              {scannerError}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
type Receipt = {
  client_transaction_id: string;
  receipt_number: string;
  payment_status?: "paid" | "pending_verification" | "rejected";
  created_at: string;
  customer_name: string;
  customer_type?: "member" | "non_member";
  cashier_name: string;
  payment_method: string;
  payment_reference?: string | null;
  total: number;
  amount_received: number;
  change: number;
  items: Array<{
    product_id: string;
    name: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
    stock_after: number;
  }>;
  sync_status?: "saved_offline" | "synced";
};

function escapeReceiptHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatReceiptMoney(value: number) {
  return new Intl.NumberFormat("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function printThermalReceipt(
  receipt: Receipt,
  outlet: { name: string; address?: string },
) {
  const deviceSettings = loadPosDeviceSettings();
  const paperWidth = deviceSettings.paperWidth === "58" ? 58 : 80;
  const contentWidth = paperWidth - 4;
  const frame = document.createElement("iframe");
  frame.title = "Hiroma receipt print";
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "1px",
    height: "1px",
    border: "0",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(frame);

  const printWindow = frame.contentWindow;
  const printDocument = frame.contentDocument;
  if (!printWindow || !printDocument) {
    frame.remove();
    return;
  }

  const isPending = receipt.payment_status === "pending_verification";
  const itemRows = receipt.items
    .map(
      (item) => `
        <div class="item">
          <div class="item-name">${escapeReceiptHtml(item.name)}</div>
          <div class="item-line"><span>${item.quantity} x PHP ${formatReceiptMoney(item.unit_price)}</span><strong>PHP ${formatReceiptMoney(item.subtotal)}</strong></div>
        </div>`,
    )
    .join("");

  printDocument.open();
  printDocument.write(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeReceiptHtml(receipt.receipt_number)}</title>
  <style>
    @page { size: ${paperWidth}mm auto; margin: 2mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; width: ${contentWidth}mm; background: #fff; color: #000; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: ${paperWidth === 58 ? "10px" : "11px"}; line-height: 1.35; }
    .receipt { width: ${contentWidth}mm; padding: 2mm; }
    .center { text-align: center; }
    .brand { font-size: 16px; font-weight: 800; letter-spacing: .12em; }
    .subtitle { margin-top: 1mm; font-size: 10px; font-weight: 700; }
    .muted { color: #333; font-size: 9px; }
    .rule { border-top: 1px dashed #000; margin: 3mm 0; }
    .row, .item-line { display: flex; justify-content: space-between; gap: 3mm; }
    .row { margin: 1.2mm 0; }
    .row strong, .item-line strong { text-align: right; }
    .item { margin: 2mm 0; }
    .item-name { font-weight: 700; }
    .item-line { margin-top: .5mm; font-size: 10px; }
    .total { font-size: 14px; font-weight: 800; }
    .notice { margin-top: 3mm; border: 1px solid #000; padding: 2mm; font-size: 9px; font-weight: 700; text-align: center; }
    .footer { margin-top: 4mm; text-align: center; font-size: 9px; }
  </style>
</head>
<body>
  <main class="receipt">
    <header class="center">
      <div class="brand">HIROMA</div>
      <div class="subtitle">${escapeReceiptHtml(outlet.name || "POINT OF SALE")}</div>
      ${outlet.address ? `<div class="muted">${escapeReceiptHtml(outlet.address)}</div>` : ""}
      <div class="muted">${isPending ? "PAYMENT VERIFICATION SLIP" : "OFFICIAL SALES RECEIPT"}</div>
    </header>
    <div class="rule"></div>
    <div class="row"><span>Receipt</span><strong>${escapeReceiptHtml(receipt.receipt_number)}</strong></div>
    <div class="row"><span>Date</span><strong>${escapeReceiptHtml(new Date(receipt.created_at).toLocaleString("en-PH"))}</strong></div>
    <div class="row"><span>Customer</span><strong>${escapeReceiptHtml(receipt.customer_name)}</strong></div>
    <div class="row"><span>Cashier</span><strong>${escapeReceiptHtml(receipt.cashier_name)}</strong></div>
    <div class="rule"></div>
    ${itemRows}
    <div class="rule"></div>
    <div class="row total"><span>TOTAL</span><strong>PHP ${formatReceiptMoney(receipt.total)}</strong></div>
    <div class="row"><span>Payment</span><strong>${escapeReceiptHtml(receipt.payment_method)}</strong></div>
    <div class="row"><span>Received</span><strong>PHP ${formatReceiptMoney(receipt.amount_received)}</strong></div>
    <div class="row"><span>Change</span><strong>PHP ${formatReceiptMoney(receipt.change)}</strong></div>
    ${receipt.payment_reference ? `<div class="row"><span>Reference</span><strong>${escapeReceiptHtml(receipt.payment_reference)}</strong></div>` : ""}
    ${isPending ? '<div class="notice">PAYMENT NOT YET VERIFIED<br />DO NOT RELEASE PRODUCTS</div>' : ""}
    ${receipt.sync_status === "saved_offline" ? '<div class="notice">RECORDED OFFLINE - AWAITING SYNC</div>' : ""}
    ${receipt.customer_type === "member" ? '<div class="notice">MEMBER / RESELLER PURCHASE<br />FINAL SALE - NOT REFUNDABLE</div>' : ""}
    <footer class="footer">Thank you for choosing Hiroma.<br />Keep this receipt for your records.</footer>
  </main>
</body>
</html>`);
  printDocument.close();

  let removed = false;
  const cleanup = () => {
    if (!removed) {
      removed = true;
      frame.remove();
    }
  };
  printWindow.addEventListener("afterprint", cleanup, { once: true });
  window.setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 150);
  window.setTimeout(cleanup, 60_000);
}

export default function PointOfSalePage() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(true);
  const [showOpenShift, setShowOpenShift] = useState(false);
  const [openingCash, setOpeningCash] = useState("0");
  const [savingShift, setSavingShift] = useState(false);
  const [showCloseShift, setShowCloseShift] = useState(false);
  const [customerType, setCustomerType] = useState<CustomerType>("non_member");
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [memberScanProof, setMemberScanProof] = useState("");
  const [showMemberScanner, setShowMemberScanner] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [showProductScanner, setShowProductScanner] = useState(false);
  const [productScanMessage, setProductScanMessage] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [amountReceived, setAmountReceived] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [submittingSale, setSubmittingSale] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [queuedSales, setQueuedSales] = useState<PosQueuedSale[]>([]);
  const transactionId = useRef("");
  const closeShiftActionRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const updateConnection = () => {
      const isOnline = navigator.onLine;
      setOnline(isOnline);
      if (!isOnline) {
        setPaymentMethod("cash");
        setPaymentReference("");
      }
    };
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    const installationKey = "hiroma_pos_installation_id";
    let installationId = localStorage.getItem(installationKey);
    if (!installationId) {
      installationId = crypto.randomUUID();
      localStorage.setItem(installationKey, installationId);
    }
    const platform = `${navigator.platform || "Web"} · ${navigator.userAgent.includes("Mobile") ? "Mobile" : "Desktop"}`;
    let receiptRange: PosReceiptRange | null = null;
    try {
      receiptRange = JSON.parse(
        localStorage.getItem("hiroma_pos_receipt_range") || "null",
      );
    } catch {
      localStorage.removeItem("hiroma_pos_receipt_range");
    }
    async function initializeTerminal() {
      if (!navigator.onLine) {
        const cached = await loadPosBootstrap<Bootstrap>().catch(
          () => undefined,
        );
        if (cached) setData(cached);
        if (!cached)
          setError(
            "This device has not completed its first online POS setup. Reconnect once to prepare offline checkout.",
          );
        return;
      }

      try {
        const response = await fetch("/api/city/pos/bootstrap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            installation_id: installationId,
            name: `POS ${installationId.slice(0, 8).toUpperCase()}`,
            platform,
            receipt_range: receiptRange,
          }),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Unable to initialize POS.");
        // Establish the protected offline scope before queue effects can run.
        await savePosBootstrap(result);
        setError("");
        setData(result);
        window.dispatchEvent(new Event("hiroma:notifications-refresh"));
        localStorage.setItem(
          "hiroma_pos_receipt_range",
          JSON.stringify(result.receipt_range),
        );
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to initialize POS.",
        );
      }
    }
    void initializeTerminal();
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  useEffect(() => {
    if (!data || data.open_shift || data.blocking_shift) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("openShift") !== "1") return;
    const timer = window.setTimeout(() => setShowOpenShift(true), 0);
    return () => window.clearTimeout(timer);
  }, [data]);

  async function refreshQueue() {
    setQueuedSales(
      (await listQueuedSales()).sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      ),
    );
  }

  function openCloseShiftModal() {
    if (data?.open_shift) setShowCloseShift(true);
  }

  useEffect(() => {
    closeShiftActionRef.current = openCloseShiftModal;
  });

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("hiroma:pos-shift-state", {
        detail: { open: Boolean(data?.open_shift) },
      }),
    );
    const requestCloseShift = () => {
      closeShiftActionRef.current();
    };
    window.addEventListener("hiroma:open-close-shift", requestCloseShift);
    return () => {
      window.removeEventListener("hiroma:open-close-shift", requestCloseShift);
      window.dispatchEvent(
        new CustomEvent("hiroma:pos-shift-state", { detail: { open: false } }),
      );
    };
  }, [data?.open_shift]);

  useEffect(() => {
    if (!data?.terminal.id) return;
    const timer = window.setTimeout(() => void refreshQueue(), 0);
    return () => window.clearTimeout(timer);
  }, [data?.terminal.id]);

  useEffect(() => {
    if (!online || !data?.terminal.id) return;
    let cancelled = false;
    let active = false;
    async function synchronize() {
      if (active) return;
      active = true;
      try {
        const queue = await listQueuedSales();
        for (const sale of queue) {
          if (cancelled) return;
          await saveQueuedSale({
            ...sale,
            status: "syncing",
            error: undefined,
          });
          try {
            const response = await fetch("/api/city/pos/transactions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(sale.payload),
            });
            const result = await response.json();
            if (!response.ok)
              throw new Error(
                result.error || "Synchronization needs attention.",
              );
            await deleteQueuedSale(sale.client_transaction_id);
          } catch (reason) {
            await saveQueuedSale({
              ...sale,
              status: "needs_attention",
              error:
                reason instanceof Error
                  ? reason.message
                  : "Synchronization needs attention.",
            });
          }
        }
        if (!cancelled) await refreshQueue();
      } finally {
        active = false;
      }
    }
    void synchronize();
    const timer = window.setInterval(() => void synchronize(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [online, data?.terminal.id]);

  const filteredProducts = useMemo(
    () =>
      data?.catalog.filter((product) =>
        product.name.toLowerCase().includes(productSearch.trim().toLowerCase()),
      ) || [],
    [data?.catalog, productSearch],
  );
  const cartRows = useMemo(
    () =>
      data?.catalog
        .filter((product) => (cart[product.product_id] || 0) > 0)
        .map((product) => {
          const quantity = cart[product.product_id];
          const unitPrice =
            customerType === "member"
              ? product.reseller_price
              : product.srp_price;
          return {
            ...product,
            quantity,
            unitPrice,
            subtotal: quantity * unitPrice,
          };
        }) || [],
    [cart, customerType, data?.catalog],
  );
  const total = useMemo(
    () => cartRows.reduce((sum, row) => sum + row.subtotal, 0),
    [cartRows],
  );
  const received = Number(amountReceived) || 0;
  const isCash = paymentMethod === "cash";
  const customerReady =
    customerType === "non_member" || Boolean(selectedMember && memberScanProof);
  const paymentReady = isCash
    ? received >= total && total > 0
    : total > 0 && paymentReference.trim().length > 0;

  function setQuantity(productId: string, next: number) {
    const product = data?.catalog.find((item) => item.product_id === productId);
    if (!product) return;
    const quantity = Math.max(
      0,
      Math.min(product.stock, Number.isFinite(next) ? Math.floor(next) : 0),
    );
    setCart((current) => ({ ...current, [productId]: quantity }));
  }

  function addProductByBarcode(rawBarcode: string) {
    const barcode = rawBarcode.trim().toUpperCase();
    const product = data?.catalog.find(
      (item) => item.barcode?.toUpperCase() === barcode,
    );
    if (!product) {
      setProductScanMessage("No active product matches that barcode.");
      return false;
    }
    const current = cart[product.product_id] || 0;
    if (current >= product.stock) {
      setProductScanMessage(
        `${product.name} has no additional available stock.`,
      );
      return false;
    }
    setQuantity(product.product_id, current + 1);
    setProductScanMessage(`${product.name} added to the cart.`);
    setShowProductScanner(false);
    return true;
  }

  function selectCustomerType(next: CustomerType) {
    setCustomerType(next);
    setSelectedMember(null);
    setMemberScanProof("");
    setCart({});
    setAmountReceived("");
    setPaymentReference("");
    transactionId.current = "";
  }

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw-pos.js?v=5", {
        scope: "/",
        updateViaCache: "none",
      })
      .then(async (registered) => {
        const assets = [
          ...new Set(
            performance
              .getEntriesByType("resource")
              .map((entry) => new URL(entry.name).pathname)
              .filter((path) => path.startsWith("/_next/static/")),
          ),
        ];

        // Save the authenticated POS shell before checking for a worker update.
        // A failed or delayed update must never prevent offline preparation.
        if ("caches" in window && navigator.onLine) {
          const [pageCache, runtimeCache, shellResponse] = await Promise.all([
            caches.open("hiroma-pos-pages-v5"),
            caches.open("hiroma-pos-runtime-v5"),
            fetch("/dashboard/city/pos", {
              credentials: "include",
              cache: "no-store",
            }),
          ]);
          const shellPath = new URL(shellResponse.url).pathname;
          if (
            shellResponse.ok &&
            shellPath.startsWith("/dashboard/city/pos") &&
            shellResponse.headers.get("content-type")?.includes("text/html")
          ) {
            await pageCache.put("/dashboard/city/pos", shellResponse.clone());
          }
          await Promise.all(
            assets.map(async (path) => {
              const response = await fetch(path);
              if (response.ok) await runtimeCache.put(path, response);
            }),
          );
        }

        // Updating is best-effort. The page shell above is already safe even if
        // the browser delays service-worker activation.
        await registered.update().catch((reason) => {
          console.warn("[POS SERVICE WORKER UPDATE]", reason);
        });
        registered.waiting?.postMessage({ type: "SKIP_WAITING" });
        const registration = await navigator.serviceWorker.ready;
        (
          registration.active || navigator.serviceWorker.controller
        )?.postMessage({ type: "CACHE_POS_SHELL", assets });
      })
      .catch((reason) => {
        console.warn("[POS SERVICE WORKER]", reason);
      });
  }, []);

  async function openShift() {
    if (!data?.terminal.id) return;
    setSavingShift(true);
    setError("");
    try {
      const response = await fetch("/api/city/pos/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          terminal_id: data.terminal.id,
          opening_cash: Number(openingCash),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Unable to open shift.");
      setData((current) =>
        current ? { ...current, open_shift: result.shift } : current,
      );
      setShowOpenShift(false);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to open shift.",
      );
    } finally {
      setSavingShift(false);
    }
  }

  async function completeSale() {
    if (
      !data?.open_shift ||
      !customerReady ||
      !paymentReady ||
      cartRows.length === 0 ||
      submittingSale
    )
      return;
    if (!online && !isCash) {
      setPaymentMethod("cash");
      setPaymentReference("");
      setError(
        "Offline mode accepts cash only. Reconnect before accepting GCash, e-wallet, or bank payments.",
      );
      return;
    }
    if (!transactionId.current) transactionId.current = crypto.randomUUID();
    const localCreatedAt = new Date().toISOString();
    const range = data.receipt_range;
    if (!range || range.next > range.end) {
      setError(
        "This terminal needs a new reserved receipt-number range. Reconnect and refresh the POS.",
      );
      return;
    }
    const receiptSequence = range.next;
    const nextRange = { ...range, next: range.next + 1 };
    const receiptNumber = permanentReceiptNumber(
      data.receipt_location_code,
      data.terminal.receipt_code,
      new Date(localCreatedAt),
      receiptSequence,
    );
    setData((current) =>
      current ? { ...current, receipt_range: nextRange } : current,
    );
    localStorage.setItem("hiroma_pos_receipt_range", JSON.stringify(nextRange));
    const payload = {
      client_transaction_id: transactionId.current,
      receipt_number: receiptNumber,
      receipt_sequence: receiptSequence,
      terminal_id: data.terminal.id,
      shift_id: data.open_shift.id,
      customer_type: customerType,
      member_id: selectedMember?.id || null,
      scan_proof: customerType === "member" ? memberScanProof : null,
      customer_name: customerName,
      payment_method: paymentMethod,
      payment_reference: isCash ? null : paymentReference,
      captured_offline: !online,
      amount_received: isCash ? received : total,
      items: cartRows.map((row) => ({
        product_id: row.product_id,
        quantity: row.quantity,
      })),
      local_created_at: localCreatedAt,
    };
    if (!online) {
      if (customerType === "member") {
        setError(
          "Offline member verification is not enabled yet. Reconnect or record this as a non-member cash sale.",
        );
        return;
      }
      const offlineReceipt: Receipt = {
        client_transaction_id: transactionId.current,
        receipt_number: receiptNumber,
        created_at: localCreatedAt,
        customer_name: customerName || "Walk-in Customer",
        customer_type: "non_member",
        cashier_name: data.cashier.full_name,
        payment_method: "Cash",
        total,
        amount_received: received,
        change: Math.round((received - total) * 100) / 100,
        sync_status: "saved_offline",
        items: cartRows.map((row) => ({
          product_id: row.product_id,
          name: row.name,
          quantity: row.quantity,
          unit_price: row.unitPrice,
          subtotal: row.subtotal,
          stock_after: row.stock - row.quantity,
        })),
      };
      await saveQueuedSale({
        client_transaction_id: transactionId.current,
        receipt_number: receiptNumber,
        payload,
        receipt: offlineReceipt as unknown as Record<string, unknown>,
        status: "saved_offline",
        created_at: localCreatedAt,
      });
      setReceipt(offlineReceipt);
      setData((current) =>
        current
          ? {
              ...current,
              catalog: current.catalog.map((product) => {
                const sold = cartRows.find(
                  (row) => row.product_id === product.product_id,
                );
                return sold
                  ? { ...product, stock: product.stock - sold.quantity }
                  : product;
              }),
            }
          : current,
      );
      await refreshQueue();
      setCart({});
      setCustomerName("");
      setAmountReceived("");
      transactionId.current = "";
      return;
    }
    setSubmittingSale(true);
    setError("");
    try {
      const response = await fetch("/api/city/pos/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "The sale could not be completed.");
      const nextReceipt = result.receipt as Receipt;
      setReceipt(nextReceipt);
      setData((current) =>
        current
          ? {
              ...current,
              catalog: current.catalog.map((product) => {
                const sold = nextReceipt.items.find(
                  (item) => item.product_id === product.product_id,
                );
                return sold ? { ...product, stock: sold.stock_after } : product;
              }),
            }
          : current,
      );
      setCart({});
      setSelectedMember(null);
      setMemberScanProof("");
      setCustomerName("");
      setAmountReceived("");
      setPaymentReference("");
      transactionId.current = "";
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The sale could not be completed safely.",
      );
    } finally {
      setSubmittingSale(false);
    }
  }

  return (
    <main className="min-h-full bg-[#f4f6fb] p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-2xl bg-[#071638] p-5 text-white shadow-sm sm:p-7">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#d4af45]">
            Hiroma Point of Sale
          </p>
          <div className="mt-2 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h1 className="text-2xl font-bold">
                {data?.location?.distributor_profile?.fulfillment_outlet_name ||
                  data?.location?.full_name ||
                  "Loading terminal…"}
              </h1>
              <p className="mt-1 text-sm text-white/65">
                Dedicated cashier workspace · installable web POS · controlled
                offline queue
              </p>
              {data?.cashier && (
                <div
                  className="mt-4 flex w-fit items-center gap-3 rounded-xl border border-white/15 bg-white/10 px-3 py-2"
                  aria-label={`Logged-in cashier: ${data.cashier.full_name}`}
                >
                  <span
                    className="grid h-9 w-9 place-items-center rounded-full bg-[#d4af45] text-sm font-black text-[#071638]"
                    aria-hidden="true"
                  >
                    {data.cashier.full_name.trim().charAt(0).toUpperCase() ||
                      "C"}
                  </span>
                  <span>
                    <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-white/55">
                      Logged-in cashier
                    </span>
                    <b className="block text-sm text-white">
                      {data.cashier.full_name}
                    </b>
                    <span className="block text-xs text-white/60">
                      @{data.cashier.username}
                    </span>
                  </span>
                </div>
              )}
            </div>
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <span className="w-fit rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold">
                {online ? "● Online" : "○ Offline"}
              </span>
              {queuedSales.length > 0 && (
                <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1.5 text-xs font-bold text-amber-200">
                  {queuedSales.length} awaiting sync
                </span>
              )}
              <PosInstallControl />
            </div>
          </div>
        </header>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}
        <section className="mt-5 grid gap-4 md:grid-cols-3">
          <article className="rounded-2xl border bg-white p-5">
            <p className="text-xs font-bold uppercase text-gray-500">
              Terminal
            </p>
            <p className="mt-2 text-lg font-bold text-[#071638]">
              {data?.terminal.name || "Initializing…"}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Bound to this browser installation
            </p>
          </article>
          <article className="rounded-2xl border bg-white p-5">
            <p className="text-xs font-bold uppercase text-gray-500">
              Catalog Snapshot
            </p>
            <p className="mt-2 text-lg font-bold text-[#071638]">
              {data ? `${data.catalog.length} products` : "Loading…"}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Admin prices remain read-only
            </p>
          </article>
          <article className="rounded-2xl border bg-white p-5">
            <p className="text-xs font-bold uppercase text-gray-500">Shift</p>
            <p className="mt-2 text-lg font-bold text-[#071638]">
              {data?.open_shift
                ? "Open"
                : data?.blocking_shift?.status === "needs_review"
                  ? "Recount required"
                  : data?.blocking_shift
                    ? "Pending review"
                    : "Not opened"}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              {data?.cashier
                ? `Cashier: ${data.cashier.full_name}`
                : "Loading cashier identity…"}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Final close requires successful sync
            </p>
          </article>
        </section>

        {!data?.open_shift && (
          <section className="mt-5 rounded-2xl border bg-white p-5 sm:p-7">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-lg font-bold text-[#071638]">
                  {data?.blocking_shift?.status === "needs_review"
                    ? "Shift returned for recount"
                    : data?.blocking_shift
                      ? "Waiting for manager review"
                      : "Start cashier operations"}
                </h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600">
                  {data?.blocking_shift?.status === "needs_review"
                    ? `Manager note: ${data.blocking_shift.closing_explanation || "Please recount the drawer and inventory, then resubmit this same shift."}`
                    : data?.blocking_shift
                      ? "Your submitted count is locked while an authorized manager reviews it. A new shift cannot be opened yet."
                      : "Enter the physical cash currently inside the drawer before accepting the first transaction."}
                </p>
              </div>
              <button
                disabled={!data}
                onClick={() =>
                  data?.blocking_shift
                    ? window.location.assign("/dashboard/city/pos/history")
                    : setShowOpenShift(true)
                }
                className="rounded-xl bg-[#d4af45] px-5 py-3 text-sm font-bold text-[#071638] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {data?.blocking_shift?.status === "needs_review"
                  ? "Review & Recount"
                  : data?.blocking_shift
                    ? "View Shift"
                    : "Open Shift"}
              </button>
            </div>
          </section>
        )}

        {data?.open_shift && (
          <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
            <div className="border-b px-5 py-4 sm:px-6">
              <h2 className="text-lg font-bold text-[#071638]">
                New walk-in sale
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Choose the customer type first. Member sales use reseller price;
                non-member sales use SRP.
              </p>
            </div>
            <div className="grid min-h-[520px] lg:grid-cols-[minmax(0,1.35fr)_minmax(340px,.65fr)]">
              <div className="border-b p-5 lg:border-b-0 lg:border-r sm:p-6">
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => selectCustomerType("member")}
                    className={`rounded-xl border p-4 text-left transition ${customerType === "member" ? "border-[#d4af45] bg-[#fff9e8] ring-1 ring-[#d4af45]" : "hover:bg-gray-50"}`}
                  >
                    <b className="block text-sm text-[#071638]">
                      Member / Reseller
                    </b>
                    <span className="mt-1 block text-xs text-gray-500">
                      Identify member · reseller price
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => selectCustomerType("non_member")}
                    className={`rounded-xl border p-4 text-left transition ${customerType === "non_member" ? "border-[#d4af45] bg-[#fff9e8] ring-1 ring-[#d4af45]" : "hover:bg-gray-50"}`}
                  >
                    <b className="block text-sm text-[#071638]">Non-member</b>
                    <span className="mt-1 block text-xs text-gray-500">
                      Walk-in customer · SRP
                    </span>
                  </button>
                </div>

                {customerType === "member" ? (
                  <div className="mt-4">
                    {selectedMember ? (
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-green-300 bg-green-50 p-4">
                        <div>
                          <span className="text-xs font-bold uppercase text-green-700">
                            Digital ID verified
                          </span>
                          <b className="mt-1 block text-sm text-[#071638]">
                            {selectedMember.full_name}
                          </b>
                          <span className="text-xs text-gray-500">
                            @{selectedMember.username}
                            {selectedMember.member_id
                              ? ` · ${selectedMember.member_id}`
                              : ""}
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            setSelectedMember(null);
                            setMemberScanProof("");
                            setShowMemberScanner(true);
                          }}
                          className="rounded-lg border bg-white px-3 py-2 text-xs font-bold"
                        >
                          Scan another
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                        <b className="block text-sm text-[#071638]">
                          Verify the reseller before adding products
                        </b>
                        <p className="mt-1 text-sm leading-6 text-gray-600">
                          Scan the QR from their Hiroma Digital ID. A name or
                          username alone does not unlock reseller pricing.
                        </p>
                        <button
                          type="button"
                          disabled={!online}
                          onClick={() => setShowMemberScanner(true)}
                          className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#071638] px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          ▣ Scan Digital ID QR
                        </button>
                        {!online ? (
                          <p className="mt-2 text-xs font-semibold text-amber-700">
                            Reconnect to verify a member. Offline sales are
                            non-member cash sales only.
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : (
                  <label className="mt-4 block">
                    <span className="text-xs font-bold text-[#071638]">
                      Customer name{" "}
                      <span className="font-normal text-gray-400">
                        (optional)
                      </span>
                    </span>
                    <input
                      value={customerName}
                      onChange={(event) => setCustomerName(event.target.value)}
                      maxLength={120}
                      placeholder="Walk-in customer"
                      className="mt-2 w-full rounded-xl border bg-[#f7f8fb] px-4 py-3 text-sm outline-none focus:border-[#d4af45]"
                    />
                  </label>
                )}

                <div className="mt-5 border-t pt-5">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs font-bold text-[#071638]">
                      Products
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setProductScanMessage("");
                        setShowProductScanner(true);
                      }}
                      className="rounded-lg bg-[#071638] px-3 py-2 text-xs font-bold text-white"
                    >
                      ▣ Scan barcode
                    </button>
                  </div>
                  <input
                    value={productSearch}
                    onChange={(event) => setProductSearch(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        addProductByBarcode(productSearch)
                      )
                        setProductSearch("");
                    }}
                    placeholder="Search products or scan/type barcode…"
                    className="mt-2 w-full rounded-xl border bg-[#f7f8fb] px-4 py-3 text-sm outline-none focus:border-[#d4af45]"
                  />
                  {productScanMessage ? (
                    <p
                      className={`mt-2 text-xs font-semibold ${productScanMessage.includes("added") ? "text-green-700" : "text-amber-700"}`}
                    >
                      {productScanMessage}
                    </p>
                  ) : null}
                </div>
                <div className="mt-3 space-y-2">
                  {filteredProducts.map((product) => {
                    const price =
                      customerType === "member"
                        ? product.reseller_price
                        : product.srp_price;
                    const quantity = cart[product.product_id] || 0;
                    return (
                      <article
                        key={product.product_id}
                        className="flex flex-col justify-between gap-3 rounded-xl border p-4 sm:flex-row sm:items-center"
                      >
                        <div>
                          <b className="text-sm text-[#071638]">
                            {product.name}
                          </b>
                          <p className="mt-1 text-xs text-gray-500">
                            ₱
                            {price.toLocaleString("en-PH", {
                              minimumFractionDigits: 2,
                            })}{" "}
                            · {product.stock} in stock · {product.pu_value} PU
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            disabled={quantity === 0}
                            onClick={() =>
                              setQuantity(product.product_id, quantity - 1)
                            }
                            className="h-9 w-9 rounded-lg border font-bold disabled:opacity-30"
                          >
                            −
                          </button>
                          <input
                            aria-label={`${product.name} quantity`}
                            type="number"
                            min="0"
                            max={product.stock}
                            value={quantity || ""}
                            placeholder="0"
                            onChange={(event) =>
                              setQuantity(
                                product.product_id,
                                Number(event.target.value),
                              )
                            }
                            className="h-9 w-16 rounded-lg border text-center text-sm font-bold outline-none focus:border-[#d4af45]"
                          />
                          <button
                            disabled={quantity >= product.stock}
                            onClick={() =>
                              setQuantity(product.product_id, quantity + 1)
                            }
                            className="h-9 w-9 rounded-lg bg-[#071638] font-bold text-white disabled:opacity-30"
                          >
                            +
                          </button>
                        </div>
                      </article>
                    );
                  })}
                  {filteredProducts.length === 0 && (
                    <p className="rounded-xl border border-dashed p-8 text-center text-sm text-gray-400">
                      No matching products.
                    </p>
                  )}
                </div>
              </div>

              <aside className="flex flex-col bg-[#fbfcff] p-5 sm:p-6">
                <h3 className="font-bold text-[#071638]">Order summary</h3>
                <div className="mt-4 min-h-32 flex-1 space-y-3">
                  {cartRows.length ? (
                    cartRows.map((row) => (
                      <div
                        key={row.product_id}
                        className="rounded-xl border bg-white p-3"
                      >
                        <div className="flex justify-between gap-3">
                          <b className="text-sm text-[#071638]">{row.name}</b>
                          <b className="text-sm">
                            ₱
                            {row.subtotal.toLocaleString("en-PH", {
                              minimumFractionDigits: 2,
                            })}
                          </b>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                          {row.quantity} × ₱
                          {row.unitPrice.toLocaleString("en-PH", {
                            minimumFractionDigits: 2,
                          })}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-xl border border-dashed p-8 text-center text-sm text-gray-400">
                      No items yet
                    </p>
                  )}
                </div>
                <div className="mt-5 border-t pt-5">
                  <div className="flex items-center justify-between text-lg font-bold text-[#071638]">
                    <span>Total</span>
                    <span>
                      ₱
                      {total.toLocaleString("en-PH", {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                  <label className="mt-4 block text-xs font-bold text-[#071638]">
                    Payment method
                    <select
                      value={paymentMethod}
                      disabled={!online}
                      onChange={(event) => {
                        setPaymentMethod(event.target.value);
                        setAmountReceived("");
                        setPaymentReference("");
                      }}
                      className="mt-2 w-full rounded-xl border bg-white px-3 py-3 text-sm outline-none focus:border-[#d4af45]"
                    >
                      {data.payment_methods
                        .filter((method) => online || method.type === "cash")
                        .map((method) => (
                          <option
                            key={method.id}
                            value={method.type === "cash" ? "cash" : method.id}
                          >
                            {method.type === "cash"
                              ? "Cash"
                              : `${method.type.toUpperCase()} · ${method.account_name}${method.account_number ? ` · ${method.account_number}` : ""}`}
                          </option>
                        ))}
                    </select>
                  </label>
                  {!online && (
                    <div
                      className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-900"
                      role="status"
                    >
                      <b>Offline mode: Cash only.</b> GCash, e-wallet, and bank
                      payments require an internet connection and independent
                      verification before products can be released.
                    </div>
                  )}
                  {isCash && (
                    <label className="mt-4 block text-xs font-bold text-[#071638]">
                      Cash received
                      <div className="mt-2 flex items-center rounded-xl border bg-white px-3 focus-within:border-[#d4af45]">
                        <span className="font-bold text-gray-500">₱</span>
                        <input
                          value={amountReceived}
                          onChange={(event) =>
                            setAmountReceived(event.target.value)
                          }
                          type="number"
                          min="0"
                          step="0.01"
                          className="w-full bg-transparent px-2 py-3 text-sm font-bold outline-none"
                        />
                      </div>
                    </label>
                  )}
                  {!isCash && (
                    <label className="mt-4 block text-xs font-bold text-[#071638]">
                      Payment reference
                      <input
                        value={paymentReference}
                        onChange={(event) =>
                          setPaymentReference(event.target.value)
                        }
                        maxLength={160}
                        placeholder="Transaction or reference number"
                        className="mt-2 w-full rounded-xl border bg-white px-3 py-3 text-sm outline-none focus:border-[#d4af45]"
                      />
                    </label>
                  )}
                  {isCash && received >= total && total > 0 && (
                    <p className="mt-3 text-sm font-bold text-green-700">
                      Change: ₱
                      {(received - total).toLocaleString("en-PH", {
                        minimumFractionDigits: 2,
                      })}
                    </p>
                  )}
                  {!customerReady && (
                    <p className="mt-3 text-xs font-semibold text-amber-700">
                      Identify and verify the member before checkout.
                    </p>
                  )}
                  <button
                    disabled={
                      !customerReady ||
                      !paymentReady ||
                      cartRows.length === 0 ||
                      submittingSale ||
                      (!online && (!isCash || customerType === "member"))
                    }
                    onClick={completeSale}
                    className="mt-5 w-full rounded-xl bg-[#d4af45] px-4 py-3 text-sm font-bold text-[#071638] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submittingSale
                      ? "Saving safely…"
                      : online
                        ? isCash
                          ? "Complete Sale"
                          : "Submit for Verification"
                        : "Save Offline Sale"}
                  </button>
                  <p className="mt-2 text-center text-[11px] leading-5 text-gray-500">
                    {online
                      ? isCash
                        ? "Cash checkout is finalized immediately after official price, shift, and stock validation."
                        : "Non-cash payment is reserved and sent to a different authorized approver. Do not release the products until it is verified."
                      : "Offline checkout currently supports non-member cash sales. Its permanent receipt number remains unchanged after synchronization."}
                  </p>
                </div>
              </aside>
            </div>
          </section>
        )}
        <PosCloseShiftModal
          open={showCloseShift}
          shiftId={data?.open_shift?.id || null}
          onClose={() => setShowCloseShift(false)}
          onCompleted={() => window.location.reload()}
        />
        {showOpenShift && (
          <div
            className="fixed inset-0 z-50 grid place-items-center bg-[#071638]/60 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="open-shift-title"
          >
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
              <h2
                id="open-shift-title"
                className="text-xl font-bold text-[#071638]"
              >
                Open cashier shift
              </h2>
              <p className="mt-2 text-sm leading-6 text-gray-600">
                Count the cash already in the drawer. This becomes the shift’s
                opening cash—not a sale.
              </p>
              <label className="mt-5 block text-sm font-bold text-[#071638]">
                Opening cash
              </label>
              <div className="mt-2 flex items-center rounded-xl border bg-[#f7f8fb] px-4 focus-within:border-[#d4af45]">
                <span className="font-bold text-gray-500">₱</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={openingCash}
                  onChange={(event) => setOpeningCash(event.target.value)}
                  className="w-full bg-transparent px-3 py-3 text-lg font-bold outline-none"
                />
              </div>
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setShowOpenShift(false)}
                  className="rounded-xl border px-4 py-2.5 text-sm font-bold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={savingShift || Number(openingCash) < 0}
                  onClick={openShift}
                  className="rounded-xl bg-[#d4af45] px-4 py-2.5 text-sm font-bold text-[#071638] disabled:opacity-50"
                >
                  {savingShift ? "Opening…" : "Confirm & Open"}
                </button>
              </div>
            </div>
          </div>
        )}
        {receipt && (
          <div
            className="pos-print-overlay fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#071638]/70 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="receipt-title"
          >
            <div className="pos-print-receipt my-6 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
              <div className="text-center">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#b18512]">
                  Hiroma Point of Sale
                </p>
                <h2
                  id="receipt-title"
                  className="mt-2 text-2xl font-bold text-[#071638]"
                >
                  {receipt.payment_status === "pending_verification"
                    ? "Payment awaiting verification"
                    : "Payment received"}
                </h2>
                <p className="mt-1 text-xs text-gray-500">
                  Receipt {receipt.receipt_number}
                </p>
                {receipt.sync_status === "saved_offline" && (
                  <p className="mx-auto mt-3 w-fit rounded-full bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-800">
                    Recorded offline · awaiting synchronization
                  </p>
                )}
                {receipt.payment_status === "pending_verification" && (
                  <p className="mx-auto mt-3 max-w-sm rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-800">
                    Pending independent verification. This is not yet a paid
                    receipt; do not release products until an authorized
                    approver confirms the payment.
                  </p>
                )}
                {receipt.customer_type === "member" && (
                  <p className="mx-auto mt-3 max-w-sm rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-800">
                    Member/Reseller purchase · Not eligible for void or refund
                    because this transaction may include PU, rewards,
                    commissions, rank progress, or wallet credits.
                  </p>
                )}
              </div>
              <div className="mt-5 border-y py-4 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-gray-500">Customer</span>
                  <b className="text-right">{receipt.customer_name}</b>
                </div>
                <div className="mt-2 flex justify-between gap-4">
                  <span className="text-gray-500">Cashier</span>
                  <b className="text-right">{receipt.cashier_name}</b>
                </div>
                <div className="mt-2 flex justify-between gap-4">
                  <span className="text-gray-500">Date</span>
                  <b className="text-right">
                    {new Date(receipt.created_at).toLocaleString("en-PH")}
                  </b>
                </div>
              </div>
              <div className="my-4 space-y-3">
                {receipt.items.map((item) => (
                  <div
                    key={item.product_id}
                    className="flex justify-between gap-4 text-sm"
                  >
                    <div>
                      <b>{item.name}</b>
                      <p className="text-xs text-gray-500">
                        {item.quantity} × ₱
                        {item.unit_price.toLocaleString("en-PH", {
                          minimumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <b>
                      ₱
                      {item.subtotal.toLocaleString("en-PH", {
                        minimumFractionDigits: 2,
                      })}
                    </b>
                  </div>
                ))}
              </div>
              <div className="border-t pt-4 text-sm">
                <div className="flex justify-between text-lg font-bold">
                  <span>Total</span>
                  <span>
                    ₱
                    {receipt.total.toLocaleString("en-PH", {
                      minimumFractionDigits: 2,
                    })}
                  </span>
                </div>
                <div className="mt-2 flex justify-between">
                  <span className="text-gray-500">Payment</span>
                  <b>{receipt.payment_method}</b>
                </div>
                <div className="mt-2 flex justify-between">
                  <span className="text-gray-500">Received</span>
                  <b>
                    ₱
                    {receipt.amount_received.toLocaleString("en-PH", {
                      minimumFractionDigits: 2,
                    })}
                  </b>
                </div>
                {receipt.change > 0 && (
                  <div className="mt-2 flex justify-between text-green-700">
                    <span>Change</span>
                    <b>
                      ₱
                      {receipt.change.toLocaleString("en-PH", {
                        minimumFractionDigits: 2,
                      })}
                    </b>
                  </div>
                )}
              </div>
              <div className="pos-print-actions mt-5 grid grid-cols-2 gap-2">
                <button
                  onClick={() =>
                    printThermalReceipt(receipt, {
                      name:
                        data?.receipt_outlet_name ||
                        data?.location?.distributor_profile
                          ?.fulfillment_outlet_name ||
                        data?.location?.full_name ||
                        "HIROMA POINT OF SALE",
                      address: data?.receipt_address,
                    })
                  }
                  className="rounded-lg border px-3 py-2.5 text-sm font-semibold"
                >
                  {receipt.payment_status === "pending_verification"
                    ? "Print pending slip"
                    : "Print receipt"}
                </button>
                <button
                  onClick={() => setReceipt(null)}
                  className="rounded-lg bg-[#d4af45] px-3 py-2.5 text-sm font-semibold text-[#071638]"
                >
                  New sale
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {showMemberScanner ? (
        <PosMemberQrScanner
          onClose={() => setShowMemberScanner(false)}
          onVerified={(member, proof) => {
            setSelectedMember(member);
            setMemberScanProof(proof);
            setShowMemberScanner(false);
            setError("");
          }}
        />
      ) : null}
      {showProductScanner ? (
        <PosProductScanner
          onClose={() => setShowProductScanner(false)}
          onDetected={addProductByBarcode}
        />
      ) : null}
    </main>
  );
}
