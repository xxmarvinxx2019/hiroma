import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const { status } = await req.json()

    if (!['active', 'inactive', 'suspended'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
    }

    await prisma.user.update({
      where: { id },
      data: { status },
    })

    return NextResponse.json({ success: true, message: `Reseller status updated to ${status}.` })
  } catch (error) {
    console.error('[UPDATE RESELLER STATUS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}