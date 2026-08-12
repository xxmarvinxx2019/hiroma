import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/app/lib/auth";
import prisma from "@/app/lib/prisma";
import { getSupportAgents } from "@/app/lib/supportRouting";
import { deleteExpiredResolvedSupportTickets } from "@/app/lib/supportRetention";
import {
  canTransitionSupportTicketStatus,
  type SupportTicketStatus,
} from "@/app/lib/supportStatusPolicy";

const statuses = new Set(["new", "reviewing", "resolved"]);
const priorities = new Set(["low", "normal", "high", "urgent"]);
const categoryLabels: Record<string, string> = {
  account_access: "account access or login",
  profile_and_verification: "profile or verification",
  digital_id: "Digital ID",
  registration_and_pin: "registration or PIN",
  referral_and_sponsorship: "referral or sponsorship",
  binary_tree_and_genealogy: "binary tree or genealogy",
  commissions_and_points: "commissions or points",
  wallet_and_payout: "wallet or payout",
  orders_and_delivery: "order or delivery",
  products_and_pricing: "product or pricing",
  payment_issue: "payment",
  website_or_app_problem: "website or app",
  security_and_account_safety: "account security",
  suggestion: "suggestion",
  feedback: "feedback",
  bug: "website problem",
  support: "support request",
  other: "support request",
};

async function getAgent() {
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.is_staff && user.permissions?.includes("support_center"))
    return {
      user,
      agentId: user.actor_id || user.id,
      ownerId: user.owner_id || user.id,
      admin: false,
    };
  if (user.role === "admin")
    return { user, agentId: user.id, ownerId: user.id, admin: true };
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const agent = await getAgent();
    if (!agent)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await deleteExpiredResolvedSupportTickets();
    const params = request.nextUrl.searchParams;
    const search = params.get("search")?.trim().slice(0, 100) || "";
    const status = params.get("status") || "all";
    const source = params.get("source") || "all";
    const where: Prisma.SupportRequestWhereInput = {
      ...(!agent.admin ? { assigned_to: agent.agentId } : {}),
      ...(statuses.has(status)
        ? { status: status as "new" | "reviewing" | "resolved" }
        : {}),
      ...(source === "public" || source === "member" ? { source } : {}),
      ...(search
        ? {
            OR: [
              { ticket_number: { contains: search, mode: "insensitive" } },
              { subject: { contains: search, mode: "insensitive" } },
              { message: { contains: search, mode: "insensitive" } },
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              {
                submitter: {
                  is: {
                    OR: [
                      { full_name: { contains: search, mode: "insensitive" } },
                      { username: { contains: search, mode: "insensitive" } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [requests, staff] = await Promise.all([
      prisma.supportRequest.findMany({
        where,
        orderBy: { updated_at: "desc" },
        take: 200,
        include: {
          submitter: {
            select: {
              full_name: true,
              username: true,
              email: true,
              member_id: true,
            },
          },
          assignee: { select: { id: true, full_name: true, username: true } },
          messages: {
            orderBy: { created_at: "asc" },
            select: {
              id: true,
              author_name: true,
              author_role: true,
              message: true,
              created_at: true,
            },
          },
        },
      }),
      getSupportAgents(agent.ownerId),
    ]);
    return NextResponse.json({
      requests,
      staff,
      is_admin: agent.admin,
    });
  } catch (error) {
    console.error("[SUPPORT TICKETS GET]", error);
    return NextResponse.json(
      { error: "Unable to load tickets." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const agent = await getAgent();
    if (!agent)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    const id = typeof body.id === "string" ? body.id : "";
    const status = typeof body.status === "string" ? body.status : "";
    const priority = typeof body.priority === "string" ? body.priority : "";
    if (
      !id ||
      (status && !statuses.has(status)) ||
      (priority && !priorities.has(priority))
    )
      return NextResponse.json(
        { error: "Invalid ticket update." },
        { status: 400 },
      );
    const ticket = await prisma.supportRequest.findUnique({
      where: { id },
      select: {
        assigned_to: true,
        status: true,
        ticket_number: true,
        category: true,
        category_detail: true,
        assignee: { select: { full_name: true } },
      },
    });
    if (!ticket || (!agent.admin && ticket.assigned_to !== agent.agentId))
      return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
    if (
      status &&
      !canTransitionSupportTicketStatus(
        ticket.status as SupportTicketStatus,
        status as SupportTicketStatus,
      )
    )
      return NextResponse.json(
        {
          error:
            "Resolved tickets are permanently closed. Create a new ticket for further assistance.",
        },
        { status: 409 },
      );
    const assignedTo =
      typeof body.assigned_to === "string" || body.assigned_to === null
        ? body.assigned_to
        : undefined;
    const assignee = assignedTo
      ? (await getSupportAgents(agent.ownerId)).find(
          (supportAgent) => supportAgent.id === assignedTo,
        )
      : null;
    if (assignedTo && !assignee)
      return NextResponse.json(
        { error: "Choose an active Hiroma support staff account." },
        { status: 400 },
      );
    const closingNow = status === "resolved" && ticket.status !== "resolved";
    const topic =
      ticket.category === "other" && ticket.category_detail
        ? ticket.category_detail
        : categoryLabels[ticket.category] || "support";
    const closingMessage = `Your ticket ${ticket.ticket_number} has been resolved and this conversation is now closed. Our support team has completed the review of your ${topic} concern. Thank you for your time and patience. If you need further assistance, please create a new support ticket and reference ${ticket.ticket_number}.`;
    const transferred =
      assignedTo !== undefined && assignedTo !== ticket.assigned_to;
    const transferMessage = assignee
      ? `Your ticket ${ticket.ticket_number} has been transferred to ${assignee.full_name}. This specialist is best placed to help with your concern and will continue the conversation here.`
      : `Your ticket ${ticket.ticket_number} has been returned to the Hiroma Support queue for reassignment.`;
    const [updated] = await prisma.$transaction([
      prisma.supportRequest.update({
        where: { id },
        data: {
          ...(status
            ? { status: status as "new" | "reviewing" | "resolved" }
            : {}),
          ...(priority
            ? { priority: priority as "low" | "normal" | "high" | "urgent" }
            : {}),
          ...(assignedTo !== undefined
            ? { assigned_to: assignedTo || null }
            : {}),
          ...(agent.admin && typeof body.admin_notes === "string"
            ? { admin_notes: body.admin_notes.trim().slice(0, 2000) || null }
            : {}),
        },
      }),
      ...(closingNow
        ? [
            prisma.supportMessage.create({
              data: {
                request_id: id,
                author_id: null,
                author_name: "Hiroma Support",
                author_role: "system",
                message: closingMessage,
              },
            }),
          ]
        : []),
      ...(transferred
        ? [
            prisma.supportMessage.create({
              data: {
                request_id: id,
                author_id: null,
                author_name: "Hiroma Support",
                author_role: "system",
                message: transferMessage,
              },
            }),
          ]
        : []),
    ]);
    return NextResponse.json({ request: updated });
  } catch (error) {
    console.error("[SUPPORT TICKETS PATCH]", error);
    return NextResponse.json(
      { error: "Unable to update this ticket." },
      { status: 500 },
    );
  }
}
