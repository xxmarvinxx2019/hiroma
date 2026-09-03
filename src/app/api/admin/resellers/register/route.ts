import { NextResponse } from "next/server";
import { getCurrentUser } from "@/app/lib/auth";

// Admin accounts are governance/reporting identities. Keeping this route as a
// hard denial (with no dormant registration engine behind a feature flag)
// prevents a future toggle or refactor from bypassing outlet attribution,
// inventory release, paid PIN evidence, and registration funding controls.
export async function POST() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    {
      error:
        "Direct Admin reseller registration is disabled. Use an authorized City Distributor or Hiroma Branch account.",
    },
    { status: 403 },
  );
}
