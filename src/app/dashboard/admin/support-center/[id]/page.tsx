"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Image from "next/image";
type Ticket = {
  id: string;
  ticket_number: string;
  subject: string;
  message: string;
  status: string;
  priority: string;
  assigned_to: string | null;
  attachments: { id: string; filename: string; url: string | null }[];
  messages: {
    id: string;
    author_name: string;
    author_role: string;
    message: string;
    created_at: string;
  }[];
};
type Agent = { id: string; full_name: string };
export default function AdminTicketPage() {
  const { id } = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<Ticket | null>(null),
    [agents, setAgents] = useState<Agent[]>([]),
    [reply, setReply] = useState(""),
    [sending, setSending] = useState(false);
  const load = async () => {
    const [ticketRes, listRes] = await Promise.all([
      fetch(`/api/support/tickets/${id}/messages`),
      fetch("/api/admin/support-requests"),
    ]);
    const ticketData = await ticketRes.json();
    const listData = await listRes.json();
    setTicket(ticketData.ticket || null);
    setAgents(listData.staff || []);
  };
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [id]);
  async function patch(data: object) {
    await fetch("/api/admin/support-requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...data }),
    });
    load();
  }
  async function send() {
    if (sending || reply.trim().length < 2) return;
    setSending(true);
    const r = await fetch(`/api/support/tickets/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: reply }),
    });
    if (r.ok) {
      setReply("");
      await load();
    }
    setSending(false);
  }
  if (!ticket) return <p className="text-sm text-gray-400">Loading ticket…</p>;
  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <Link
        href="/dashboard/admin/support-center"
        className="text-sm font-semibold text-[#9a741f]"
      >
        ← Back to Support Center
      </Link>
      <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold text-[#9a741f]">
            {ticket.ticket_number}
          </p>
          <h1 className="mt-1 text-xl font-semibold text-[#0D1B3E]">
            {ticket.subject}
          </h1>
          <p className="mt-5 whitespace-pre-wrap text-sm leading-6">
            {ticket.message}
          </p>
          {ticket.attachments.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-3">
              {ticket.attachments.map((a) =>
                a.url ? (
                  <a key={a.id} href={a.url} target="_blank">
                    <Image
                      src={a.url}
                      alt={a.filename}
                      width={160}
                      height={112}
                      unoptimized
                      className="rounded-xl border object-cover"
                    />
                  </a>
                ) : null,
              )}
            </div>
          )}
        </div>
        <aside className="h-fit space-y-3 rounded-2xl bg-white p-5 shadow-sm">
          <label className="block text-xs font-semibold">
            Status
            <select
              value={ticket.status}
              disabled={ticket.status === "resolved"}
              onChange={(e) => patch({ status: e.target.value })}
              className="mt-1 w-full rounded-lg border p-2 disabled:cursor-not-allowed disabled:bg-emerald-50 disabled:font-semibold disabled:text-emerald-700"
            >
              <option value="new">Open</option>
              <option value="reviewing">In progress</option>
              <option value="resolved">Resolved</option>
            </select>
            {ticket.status === "resolved" && (
              <span className="mt-2 block text-[11px] font-normal leading-4 text-gray-500">
                Permanently closed. A new ticket is required for further
                assistance.
              </span>
            )}
          </label>
          <label className="block text-xs font-semibold">
            Priority
            <select
              value={ticket.priority}
              onChange={(e) => patch({ priority: e.target.value })}
              className="mt-1 w-full rounded-lg border p-2"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          <label className="block text-xs font-semibold">
            Assign to
            <select
              value={ticket.assigned_to || ""}
              onChange={(e) => patch({ assigned_to: e.target.value || null })}
              className="mt-1 w-full rounded-lg border p-2"
            >
              <option value="">Unassigned</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.full_name}
                </option>
              ))}
            </select>
          </label>
        </aside>
      </div>
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-[#0D1B3E]">Conversation</h2>
        <div className="mt-4 max-h-[460px] space-y-3 overflow-y-auto overscroll-contain rounded-2xl bg-[#F8F9FC] p-3 sm:p-4">
          {ticket.messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[86%] rounded-xl p-4 text-sm ${m.author_role === "member" ? "mr-auto bg-[#F0F2F8]" : "ml-auto bg-[#010521] text-white"}`}
            >
              <b>
                {m.author_role === "member"
                  ? m.author_name
                  : m.author_role === "system"
                    ? "Hiroma Support · Ticket update"
                    : "Hiroma Support"}
              </b>
              <p className="mt-1 whitespace-pre-wrap">{m.message}</p>
              <small className="mt-2 block text-[10px] opacity-60">
                {new Date(m.created_at).toLocaleString()}
              </small>
            </div>
          ))}
        </div>
        {ticket.status !== "resolved" && (
          <div className="mt-5 border-t border-[#0D1B3E]/10 pt-4">
            <textarea
              value={reply}
              disabled={sending}
              onChange={(e) => setReply(e.target.value)}
              rows={4}
              placeholder="Reply to this ticket..."
              className="w-full rounded-xl border p-3 text-sm"
            />
            <button
              onClick={send}
              disabled={sending || reply.trim().length < 2}
              className="mt-2 rounded-xl bg-[#C9A84C] px-4 py-2.5 text-sm font-semibold text-[#0D1B3E] disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send reply"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
