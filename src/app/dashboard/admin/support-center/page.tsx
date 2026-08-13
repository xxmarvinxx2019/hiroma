"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Ticket = {
  id: string;
  ticket_number: string;
  subject: string;
  status: string;
  priority: string;
  source: string;
  submitter: { full_name: string } | null;
  name: string | null;
};
type Queue = "new" | "reviewing" | "resolved";
const queues: {
  key: Queue;
  label: string;
  labelShort: string;
  tone: string;
}[] = [
  {
    key: "new",
    label: "Open tickets",
    labelShort: "Open",
    tone: "border-blue-500 bg-blue-50",
  },
  {
    key: "reviewing",
    label: "In progress",
    labelShort: "In Progress",
    tone: "border-amber-500 bg-amber-50",
  },
  {
    key: "resolved",
    label: "Resolved",
    labelShort: "Resolved",
    tone: "border-emerald-500 bg-emerald-50",
  },
];
const badge = (status: string) =>
  status === "resolved"
    ? "bg-emerald-50 text-emerald-700"
    : status === "reviewing"
      ? "bg-amber-50 text-amber-700"
      : "bg-blue-50 text-blue-700";

export default function AdminSupportCenterPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [staff, setStaff] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<Queue>("new");
  const load = async () => {
    setLoading(true);
    const r = await fetch(
      `/api/admin/support-requests?search=${encodeURIComponent(search)}`,
    );
    const d = await r.json();
    setTickets(d.requests || []);
    setStaff((d.staff || []).length);
    setIsAdmin(Boolean(d.is_admin));
    setLoading(false);
  };
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const visible = tickets.filter((ticket) => ticket.status === queue);
  const count = (key: Queue) =>
    tickets.filter((ticket) => ticket.status === key).length;
  return (
    <section className="mx-auto max-w-6xl space-y-5">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[#C9A84C]">
          Ticket management
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-[#0D1B3E]">
          Support Center
        </h1>
        <p className="mt-1 text-sm text-gray-400">
          {isAdmin
            ? "Review every Hiroma support ticket."
            : "Review the tickets assigned to you."}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {queues.map((item) => (
          <button
            key={item.key}
            onClick={() => setQueue(item.key)}
            className={`rounded-2xl border-l-4 p-4 text-left shadow-sm transition ${queue === item.key ? item.tone : "border-transparent bg-white hover:bg-[#FBFBFD]"}`}
          >
            <p className="text-xs text-gray-400">
              {isAdmin ? item.label : `My ${item.label.toLowerCase()}`}
            </p>
            <b className="mt-1 block text-2xl text-[#0D1B3E]">
              {count(item.key)}
            </b>
          </button>
        ))}
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-400">Support agents</p>
          <b className="mt-1 block text-2xl text-[#0D1B3E]">{staff}</b>
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder="Search ticket number, name, subject..."
            className="min-w-[260px] flex-1 rounded-xl border px-4 py-2.5 text-sm"
          />
          <span className="text-sm font-semibold text-[#0D1B3E]">
            {queues.find((item) => item.key === queue)?.labelShort} queue
          </span>
        </div>
        {loading ? (
          <p className="p-10 text-center text-sm text-gray-400">
            Loading tickets…
          </p>
        ) : visible.length === 0 ? (
          <p className="p-10 text-center text-sm text-gray-400">
            No {queues.find((item) => item.key === queue)?.label.toLowerCase()}.
          </p>
        ) : (
          visible.map((t) => (
            <Link
              key={t.id}
              href={`/dashboard/admin/support-center/${t.id}`}
              className="grid gap-3 border-b p-5 transition hover:bg-[#FBFBFD] sm:grid-cols-[155px_1fr_130px_120px]"
            >
              <span className="text-xs font-bold text-[#9a741f]">
                {t.ticket_number}
              </span>
              <span>
                <b className="block text-sm text-[#0D1B3E]">{t.subject}</b>
                <small className="text-gray-400">
                  {t.submitter?.full_name || t.name || "Public visitor"} ·{" "}
                  {t.source}
                </small>
              </span>
              <span className="text-xs capitalize text-gray-500">
                {t.priority} priority
              </span>
              <span
                className={`h-fit w-fit rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${badge(t.status)}`}
              >
                {t.status === "reviewing" ? "In progress" : t.status}
              </span>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}
