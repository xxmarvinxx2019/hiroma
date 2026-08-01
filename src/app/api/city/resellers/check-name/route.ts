import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import { generateUsernamePlan } from '@/app/lib/usernameGenerator'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || !['city', 'admin'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const name = req.nextUrl.searchParams.get('name')?.trim() || ''
    const birthday = req.nextUrl.searchParams.get('birthday')?.trim() || ''
    const birthplace = req.nextUrl.searchParams.get('birthplace')?.trim() || ''
    if (!name || !birthday || !birthplace) {
      return NextResponse.json({
        ready: false,
        count: 0,
        max: 7,
        remaining: 7,
        proposed_username: '',
      })
    }

    const plan = await generateUsernamePlan({ fullName: name, birthday, birthplace })
    return NextResponse.json({
      ready: true,
      count: plan.existingAccountCount,
      max: plan.maxAccounts,
      remaining: plan.maxAccounts - plan.existingAccountCount,
      remaining_after_registration: plan.remainingAfterRegistration,
      account_number: plan.accountNumber,
      first_account: plan.isFirstAccount,
      proposed_username: plan.username,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to generate username.'
    const isLimit = message.startsWith('Maximum accounts')
    return NextResponse.json({ error: message }, { status: isLimit ? 409 : 400 })
  }
}