import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/app/lib/auth";
import prisma from "@/app/lib/prisma";
import { uploadSupportScreenshot } from "@/app/lib/supportAttachment";
import { selectFairSupportAgent } from "@/app/lib/supportRouting";
import {
  getSupportClientAddress,
  SUPPORT_ANONYMOUS_DAILY_EMAIL_LIMIT,
  SUPPORT_ANONYMOUS_WINDOW_LIMIT,
  SUPPORT_GLOBAL_WINDOW_LIMIT,
  SUPPORT_MEMBER_WINDOW_LIMIT,
  SUPPORT_RATE_WINDOW_MS,
  supportCaptchaAnswerDigest,
  supportClientFingerprint,
  supportEmailFingerprint,
} from "@/app/lib/supportAbuseProtection";

const categories = new Set([
  "suggestion",
  "feedback",
  "account_access",
  "profile_and_verification",
  "digital_id",
  "registration_and_pin",
  "referral_and_sponsorship",
  "binary_tree_and_genealogy",
  "commissions_and_points",
  "wallet_and_payout",
  "orders_and_delivery",
  "products_and_pricing",
  "payment_issue",
  "website_or_app_problem",
  "security_and_account_safety",
  "other",
]);

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (clean(body.website, 100))
      return NextResponse.json({ success: true }, { status: 201 });

    const category = clean(body.category, 30);
    const subject = clean(body.subject, 140);
    const message = clean(body.message, 3000);
    const categoryDetail = clean(body.category_detail, 200);
    const name = clean(body.name, 100);
    const email = clean(body.email, 160).toLowerCase();
    const currentUser = await getCurrentUser();
    const isMember = currentUser?.role === "reseller";
    const now = new Date();
    const windowStart = new Date(now.getTime() - SUPPORT_RATE_WINDOW_MS);
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const clientFingerprint = supportClientFingerprint(
      getSupportClientAddress(request.headers),
      now,
    );
    const emailFingerprint = isMember ? null : supportEmailFingerprint(email);

    if (
      !categories.has(category) ||
      subject.length < 4 ||
      message.length < 10
    ) {
      return NextResponse.json(
        { error: "Please complete the category, subject, and message." },
        { status: 400 },
      );
    }
    if (!isMember && (!name || !/^\S+@\S+\.\S+$/.test(email))) {
      return NextResponse.json(
        { error: "Please enter your name and a valid email address." },
        { status: 400 },
      );
    }
    if (category === "other" && categoryDetail.length < 4)
      return NextResponse.json(
        { error: "Please specify what your concern is about." },
        { status: 400 },
      );

    const assignee = await selectFairSupportAgent();
    const ticket = await prisma.$transaction(async (tx) => {
      const [globalRecent, submitterRecent, emailToday] = await Promise.all([
        tx.supportRequest.count({ where: { created_at: { gte: windowStart } } }),
        tx.supportRequest.count({
          where: isMember
            ? { user_id: currentUser.id, created_at: { gte: windowStart } }
            : { submitter_fingerprint: clientFingerprint, created_at: { gte: windowStart } },
        }),
        emailFingerprint
          ? tx.supportRequest.count({ where: { email_fingerprint: emailFingerprint, created_at: { gte: dayStart } } })
          : Promise.resolve(0),
      ]);
      const submitterLimit = isMember ? SUPPORT_MEMBER_WINDOW_LIMIT : SUPPORT_ANONYMOUS_WINDOW_LIMIT;
      if (
        globalRecent >= SUPPORT_GLOBAL_WINDOW_LIMIT ||
        submitterRecent >= submitterLimit ||
        emailToday >= SUPPORT_ANONYMOUS_DAILY_EMAIL_LIMIT
      ) throw new SupportSubmissionLimitError();

      if (!isMember) {
        const captchaId = typeof body.captcha_id === "string" ? body.captcha_id : "";
        const answerDigest = supportCaptchaAnswerDigest(captchaId, body.captcha_answer);
        const consumed = captchaId && answerDigest
          ? await tx.supportCaptchaChallenge.updateMany({
              where: {
                id: captchaId,
                answer_digest: answerDigest,
                client_fingerprint: clientFingerprint,
                used_at: null,
                expires_at: { gt: now },
              },
              data: { used_at: now },
            })
          : { count: 0 };
        if (consumed.count !== 1) throw new SupportCaptchaError();
      }

      const sequence = await tx.$queryRawUnsafe<{ value: bigint }[]>(
        "SELECT nextval('\"support_ticket_number_seq\"') AS value",
      );
      const ticketNumber = `HSP${String(sequence[0].value).padStart(6, "0")}`;
      const created = await tx.supportRequest.create({
        data: {
          ticket_number: ticketNumber,
          user_id: isMember ? currentUser.id : null,
          source: isMember ? "member" : "public",
          category: category as never,
          category_detail: categoryDetail || null,
          name: isMember ? currentUser.full_name : name,
          email: isMember ? null : email,
          subject,
          message,
          assigned_to: assignee?.id || null,
          submitter_fingerprint: isMember ? null : clientFingerprint,
          email_fingerprint: emailFingerprint,
        },
      });
      if (assignee) {
        await tx.supportMessage.create({
          data: {
            request_id: created.id,
            author_name: "Hiroma Support",
            author_role: "system",
            message: `Your ticket ${created.ticket_number} has been assigned to ${assignee.full_name}. This support specialist will review your concern and reply here shortly.`,
          },
        });
      }
      return created;
    }, { isolationLevel: "Serializable" });

    if (typeof body.screenshot === "string" && body.screenshot) {
      const attachment = await uploadSupportScreenshot(
        ticket.id,
        body.screenshot,
        typeof body.screenshot_name === "string"
          ? body.screenshot_name
          : "screenshot",
      );
      await prisma.supportAttachment.create({
        data: { request_id: ticket.id, ...attachment },
      });
    }

    return NextResponse.json(
      {
        success: true,
        message:
          "Thank you. Your ticket has been sent to the Hiroma support team.",
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof SupportCaptchaError)
      return NextResponse.json({ error: "Human verification is incorrect or expired. Please try again." }, { status: 400 });
    if (error instanceof SupportSubmissionLimitError)
      return NextResponse.json({ error: "Too many support requests. Please wait before trying again." }, { status: 429 });
    console.error("[SUPPORT REQUEST POST]", error);
    return NextResponse.json(
      { error: "We could not send your message. Please try again." },
      { status: 500 },
    );
  }
}

class SupportCaptchaError extends Error {}
class SupportSubmissionLimitError extends Error {}
