import prisma from "@/app/lib/prisma";

export type SupportAgent = { id: string; full_name: string };

/**
 * Select the fairest available agent. Active workload is always considered
 * first; if it is tied, the agent without the most recent ticket activity
 * receives the next ticket. This keeps assignments balanced and predictable.
 */
export async function selectFairSupportAgent(
  ownerId?: string,
): Promise<SupportAgent | null> {
  const profiles = await prisma.staffProfile.findMany({
    where: {
      is_active: true,
      permissions: { array_contains: "support_center" },
      owner: { role: "admin" },
      ...(ownerId ? { owner_id: ownerId } : {}),
    },
    orderBy: { created_at: "asc" },
    select: { user: { select: { id: true, full_name: true } } },
  });
  const agents = profiles.map((profile) => profile.user);
  if (agents.length === 0) return null;

  const ids = agents.map((agent) => agent.id);
  const [active, history] = await Promise.all([
    prisma.supportRequest.groupBy({
      by: ["assigned_to"],
      where: { assigned_to: { in: ids }, status: { in: ["new", "reviewing"] } },
      _count: { _all: true },
    }),
    prisma.supportRequest.groupBy({
      by: ["assigned_to"],
      where: { assigned_to: { in: ids } },
      _max: { updated_at: true },
    }),
  ]);
  const activeCount = new Map(
    active.map((item) => [item.assigned_to, item._count._all]),
  );
  const lastActivity = new Map(
    history.map((item) => [
      item.assigned_to,
      item._max.updated_at?.getTime() || 0,
    ]),
  );

  return [...agents].sort((a, b) => {
    const loadDifference =
      (activeCount.get(a.id) || 0) - (activeCount.get(b.id) || 0);
    if (loadDifference !== 0) return loadDifference;
    return (lastActivity.get(a.id) || 0) - (lastActivity.get(b.id) || 0);
  })[0];
}

export async function getSupportAgents(
  ownerId?: string,
): Promise<SupportAgent[]> {
  const profiles = await prisma.staffProfile.findMany({
    where: {
      is_active: true,
      permissions: { array_contains: "support_center" },
      owner: { role: "admin" },
      ...(ownerId ? { owner_id: ownerId } : {}),
    },
    orderBy: { created_at: "asc" },
    select: { user: { select: { id: true, full_name: true } } },
  });
  return profiles.map((profile) => profile.user);
}
