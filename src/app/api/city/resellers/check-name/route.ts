import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import { generateUsernamePlan } from '@/app/lib/usernameGenerator'

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function clean(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || !['city', 'admin'].includes(user.role)) {
      return json({ error: 'Unauthorized' }, 401)
    }
    if (user.is_staff && !user.permissions?.includes('register_reseller')) {
      return json({ error: 'Your staff account cannot check new reseller identities.' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const name = clean(body.name, 180)
    const birthday = clean(body.birthday, 20)
    const birthplace = clean(body.birthplace, 240)
    const identityDocumentType = clean(body.identity_document_type, 80)
    const identityDocumentNumber = clean(body.identity_document_number, 180)
    const mobile = clean(body.mobile, 40)
    const email = clean(body.email, 180).toLowerCase()
    const identityConfirmation = clean(body.identity_confirmation, 20)
    if (!name || !birthday || !birthplace) {
      return json({
        ready: false,
        count: 0,
        max: 7,
        remaining: 7,
        proposed_username: '',
      })
    }

    const plan = await generateUsernamePlan({
      fullName: name,
      birthday,
      birthplace,
      identityDocumentType,
      identityDocumentNumber,
      mobile,
      email,
      identityConfirmation: identityConfirmation === 'same' || identityConfirmation === 'different' ? identityConfirmation : undefined,
    })
    return json({
      ready: true,
      count: plan.existingAccountCount,
      max: plan.maxAccounts,
      remaining: plan.maxAccounts - plan.existingAccountCount,
      remaining_after_registration: plan.remainingAfterRegistration,
      account_number: plan.accountNumber,
      first_account: plan.isFirstAccount,
      proposed_username: plan.username,
      confirmation_required: plan.confirmationRequired,
      matching_usernames: plan.matchingUsernames,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to generate username.'
    const isLimit = message.startsWith('Maximum accounts')
    return json({ error: message }, isLimit ? 409 : 400)
  }
}
