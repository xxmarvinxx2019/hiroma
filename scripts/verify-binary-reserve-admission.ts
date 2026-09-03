import 'dotenv/config'
import prisma from '../src/app/lib/prisma'
import {
  evaluateBinaryReserveAdmission,
  loadBinaryReserveHealth,
  readBinaryReserveAdmissionPolicy,
} from '../src/app/lib/binaryReserveAdmission'

async function main() {
  const decision = await prisma.$transaction(async (tx) =>
    evaluateBinaryReserveAdmission({
      health: await loadBinaryReserveHealth(tx),
      requestedBinaryAllocation: 0,
      policy: readBinaryReserveAdmissionPolicy(),
    }),
  )

  console.log(JSON.stringify(decision, null, 2))
  if (decision.unfundedAmount > 0 || decision.unfundedCount > 0) {
    throw new Error('Historical unfunded binary reserve consumption was detected.')
  }
  if (!decision.allowed) {
    throw new Error(
      `Binary reserve admission policy is blocked: ${decision.reasons.join(', ')}`,
    )
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
