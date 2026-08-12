export interface PasskeyCounterSnapshot {
  id: string
  counter: bigint
  last_used_at: Date | null
}

export interface PasskeyCounterUpdate {
  where: {
    id: string
    counter: bigint
    last_used_at: Date | null
  }
  data: {
    counter: bigint
    last_used_at: Date
    backed_up: boolean
    device_type: string
  }
}

export type UpdatePasskeyCounter = (
  update: PasskeyCounterUpdate,
) => Promise<{ count: number }>

export function getNextPasskeyLastUsedAt(
  previousLastUsedAt: Date | null,
  now = new Date(),
): Date {
  const minimum = previousLastUsedAt ? previousLastUsedAt.getTime() + 1 : now.getTime()
  return new Date(Math.max(now.getTime(), minimum))
}

export async function persistVerifiedPasskeyCounter(
  snapshot: PasskeyCounterSnapshot,
  newCounter: number,
  backedUp: boolean,
  deviceType: string,
  updateMany: UpdatePasskeyCounter,
  now = new Date(),
): Promise<boolean> {
  const result = await updateMany({
    where: {
      id: snapshot.id,
      counter: snapshot.counter,
      last_used_at: snapshot.last_used_at,
    },
    data: {
      counter: BigInt(newCounter),
      last_used_at: getNextPasskeyLastUsedAt(snapshot.last_used_at, now),
      backed_up: backedUp,
      device_type: deviceType,
    },
  })
  return result.count === 1
}
