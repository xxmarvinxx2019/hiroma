"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Image from "next/image";
type Ticket = {
  ticket_number: string;
  subject: string;
  message: string;
  status: string;
  priority: string;
  created_at: string;
  attachments: { id: string; filename: string; url: string | null }[];
  messages: {
    id: string;
    author_name: string;
    author_role: string;
    message: string;
    created_at: string;
  }[];
};
const statusInfo: Record<
  string,
  { label: string; note: string; className: string }
> = {
  new: {
    label: "Open",
    note: "Your ticket is waiting for a support agent.",
    className: "bg-blue-50 text-blue-700",
  },
  reviewing: {
    label: "In progress",
    note: "Hiroma Support is currently reviewing your concern.",
    className: "bg-amber-50 text-amber-700",
  },
  resolved: {
    label: "Resolved",
    note: "This ticket has been completed and closed.",
    className: "bg-emerald-50 text-emerald-700",
  },
};
export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<Ticket | null>(null),
    [error, setError] = useState(""),
    [reply, setReply] = useState(""),
    [sending, setSending] = useState(false);
  const load = async () => {
    const r = await fetch(`/api/support/tickets/${id}/messages`);
    const d = await r.json();
    if (!r.ok) setError(d.error || "Unable to load ticket.");
    else setTicket(d.ticket);
  };
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [id]);
  async function send() {
    if (sending || reply.trim().length < 2) return;
    setSending(true);
    setError("");
    const r = await fetch(`/api/support/tickets/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: reply }),
    });
    const d = await r.json();
    if (r.ok) {
      setReply("");
      await load();
    } else setError(d.error || "Unable to send reply.");
    setSending(false);
  }
  if (error) return <p className="text-red-600">{error}</p>;
  if (!ticket) return <p className="text-sm text-gray-400">Loading ticket…</p>;
  const state = statusInfo[ticket.status] || statusInfo.new;
  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <Link
        href="/dashboard/reseller/support-center"
        className="text-sm font-semibold text-[#9a741f]"
      >
        ← Back to Support Center
      </Link>
      <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
        <div className="rounded-2xl border border-[#0D1B3E]/10 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold text-[#9a741f]">
            {ticket.ticket_number}
          </p>
          <h1 className="mt-1 text-xl font-semibold text-[#0D1B3E]">
            {ticket.subject}
          </h1>
          <p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-[#0D1B3E]">
            {ticket.message}
          </p>
          {ticket.attachments.length > 0 && (
            <div className="mt-6 border-t pt-5">
              <p className="text-xs font-semibold tracking-wide text-gray-500">
                SCREENSHOTS / ATTACHMENTS
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                {ticket.attachments.map((a) =>
                  a.url ? (
                    <a
                      key={a.id}
                      href={a.url}
                      target="_blank"
                      className="overflow-hidden rounded-xl border bg-[#F8F9FC]"
                    >
                      <Image
                        src={a.url}
                        alt={a.filename}
                        width={180}
                        height={126}
                        unoptimized
                        className="h-32 w-44 object-cover"
                      />
                      <span className="block truncate px-2 py-1 text-[10px] text-gray-500">
                        {a.filename}
                      </span>
                    </a>
                  ) : null,
                )}
              </div>
            </div>
          )}
        </div>
        <aside className="h-fit rounded-2xl border border-[#0D1B3E]/10 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold tracking-wide text-gray-400">
            TICKET STATUS
          </p>
          <span
            className={`mt-3 inline-block rounded-full px-3 py-1.5 text-xs font-semibold ${state.className}`}
          >
            {state.label}
          </span>
          <p className="mt-3 text-sm leading-6 text-gray-500">{state.note}</p>
          <dl className="mt-5 space-y-3 border-t pt-4 text-sm">
            <div>
              <dt className="text-xs text-gray-400">Priority</dt>
              <dd className="mt-0.5 capitalize text-[#0D1B3E]">
                {ticket.priority}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">Submitted</dt>
              <dd className="mt-0.5 text-[#0D1B3E]">
                {new Date(ticket.created_at).toLocaleString()}
              </dd>
            </div>
          </dl>
        </aside>
      </div>
      <div className="rounded-2xl border border-[#0D1B3E]/10 bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-[#0D1B3E]">Conversation</h2>
        <p className="mt-1 text-xs text-gray-400">
          You and Hiroma Support can reply here about this ticket.
        </p>
        <div className="mt-5 max-h-[460px] space-y-3 overflow-y-auto overscroll-contain rounded-2xl bg-[#F8F9FC] p-3 sm:p-4">
          {ticket.messages.length === 0 ? (
            <p className="rounded-xl bg-[#F8F9FC] p-4 text-sm text-gray-400">
              No support reply yet. We will update you here.
            </p>
          ) : (
            ticket.messages.map((m) => {
              const member = m.author_role === "member";
              return (
                <div
                  key={m.id}
                  className={`max-w-[86%] rounded-2xl p-4 text-sm ${member ? "mr-auto bg-[#F0F2F8] text-[#0D1B3E]" : "ml-auto bg-[#010521] text-white"}`}
                >
                  <p className="text-xs font-bold">
                    {member
                      ? "You"
                      : m.author_role === "support"
                        ? "Hiroma Support"
                        : m.author_role === "system"
                          ? "Hiroma Support · Ticket update"
                          : m.author_name}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap leading-6">
                    {m.message}
                  </p>
                  <small className="mt-2 block opacity-60">
                    {new Date(m.created_at).toLocaleString()}
                  </small>
                </div>
              );
            })
          )}
        </div>
        {ticket.status !== "resolved" && (
          <div className="mt-5 border-t border-[#0D1B3E]/10 pt-4">
            <label className="text-sm font-semibold text-[#0D1B3E]">
              Reply to this ticket
              <textarea
                value={reply}
                disabled={sending}
                onChange={(e) => setReply(e.target.value)}
                rows={4}
                placeholder="Add more information or answer the support team…"
                className="mt-2 w-full rounded-xl border p-3 text-sm disabled:opacity-60"
              />
            </label>
            <button
              onClick={send}
              disabled={sending || reply.trim().length < 2}
              className="mt-3 rounded-xl bg-[#C9A84C] px-4 py-2.5 text-sm font-semibold text-[#0D1B3E] disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send reply"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
