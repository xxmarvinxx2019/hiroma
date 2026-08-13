export type OrdersAndEarningsLesson = {
  id: string
  number: string
  title: string
  summary: string
  points: string[]
  safetyNote?: string
  action?: { label: string; href: string }
}

export const ordersAndEarningsCourse = {
  title: 'Orders and Earnings',
  description: 'A practical guide to reseller pricing, order status, wallet records, commissions, reserves, flashout, and payout processing in Hiroma.',
  estimatedMinutes: 35,
  lessons: [
    {
      id: 'placing-and-pricing-orders', number: '01', title: 'Placing orders and understanding prices',
      summary: 'Know where orders come from and why the price shown to a reseller may differ from the public price.',
      points: [
        'Use My Orders to review orders placed through your reseller account and their recorded totals.',
        'Authenticated members receive the price allowed for their account or reseller level; public or non-member buyers may receive SRP.',
        'A distributor walk-in order can identify a reseller by verified member selection or QR scan so the correct member and reseller pricing are attached.',
        'Always confirm the product, quantity, price, seller, delivery method, and payment method before completing an order.',
      ],
      safetyNote: 'Never send payment based only on a screenshot or chat message. Confirm the order inside Hiroma and use an approved payment channel.',
      action: { label: 'Open My Orders', href: '/dashboard/reseller/orders' },
    },
    {
      id: 'order-statuses', number: '02', title: 'Order status and cancellation',
      summary: 'Follow an order from creation to completion and understand which changes are still allowed.',
      points: [
        'Pending means the order was created but has not yet moved into fulfilment.',
        'Processing means the seller or distributor has started preparing the order.',
        'Ready for pickup means the order is prepared and waiting for the approved pickup step.',
        'Delivered means fulfilment is complete. Cancelled means the order did not proceed.',
        'A reseller can directly cancel only while the order remains pending. For later-stage corrections, contact the responsible distributor or Support Center.',
      ],
      action: { label: 'Track order status', href: '/dashboard/reseller/orders' },
    },
    {
      id: 'wallet-ledger', number: '03', title: 'Reading your wallet correctly',
      summary: 'Separate earned income, available balance, approved amounts, and released money.',
      points: [
        'The wallet is a transaction ledger. Every credit or debit should have a source, amount, date, and status.',
        'Total earned is the cumulative qualified income recorded for the account; it is not automatically equal to cash available today.',
        'Available balance is the amount currently eligible to be considered for a payout request, subject to payout rules.',
        'Approved (unreleased) is committed for payout but not yet sent. Paid or released means the payout was actually released.',
        'Use the detailed ledger when reconciling a dashboard total; do not add summary cards together when they represent different stages of the same money.',
      ],
      action: { label: 'Open Wallet', href: '/dashboard/reseller/wallet' },
    },
    {
      id: 'commission-sources', number: '04', title: 'Where earnings can come from',
      summary: 'Identify each commission source before treating an amount as payable income.',
      points: [
        'Direct referral income is created from a qualified registration under the package rules and the sponsor account qualification.',
        'Binary commission is created only when eligible left and right registration points form a payable pair under the member package and daily cap.',
        'Product Binary uses product units: 2 PU on the left plus 2 PU on the right form one pair, valued using the qualified rank rate when the pair completes.',
        'Rank, package, qualification, caps, status, and the triggering transaction can affect the final payable amount.',
        'A displayed point, carryover volume, or allocation is not automatically withdrawable cash.',
      ],
      action: { label: 'Review Rank Advancement', href: '/dashboard/reseller/points' },
    },
    {
      id: 'accounting-statuses', number: '05', title: 'Earned, reserve, approved, and paid',
      summary: 'Use the same accounting language across commissions and payouts.',
      points: [
        'Earned means a qualified commission record has been created.',
        'Reserve or liability means earned money remains unpaid; it is an obligation, not proof that cash was already transferred.',
        'Approved (unreleased) means the payout passed approval but release is still pending.',
        'Paid or released includes only money that was actually released through the payout process.',
        'Flashout is excluded from payable liability because it was retained under an applicable plan rule.',
      ],
    },
    {
      id: 'caps-flashout-carryover', number: '06', title: 'Daily caps, flashout, and carryover',
      summary: 'Understand why an eligible transaction may be paid, carried forward, or retained by Hiroma.',
      points: [
        'When an enabled direct-referral daily cap is reached, later qualified referrals that day are recorded as direct-referral flashout.',
        'Package-difference flashout can occur when the new member package allocation is higher than the sponsor package qualification. Example: a Starter sponsor qualified for PHP 300 referring a Gold allocation of PHP 1,000 earns PHP 300 and the PHP 700 difference is flashout.',
        'Binary pairs above the member package daily pair cap become binary flashout for that day.',
        'Unmatched binary points and unpaired Product Binary PU can carry forward under the applicable rules. Carryover is network volume, not cash reserve or withdrawable balance.',
        'Direct Referral, Binary Commission, and Product Binary flashout must remain separated in reports so accounting can trace the exact source.',
      ],
    },
    {
      id: 'payout-process', number: '07', title: 'Requesting a payout',
      summary: 'Complete the required account and security checks before submitting a withdrawal request.',
      points: [
        'Add and obtain approval for a payment method before requesting a payout.',
        'The current minimum payout request is PHP 500, subject to the live policy shown in the system.',
        'The account must have sufficient available balance and no other pending payout request.',
        'A configured and valid six-digit Security PIN is required for payout submission and other protected financial actions.',
        'Payout processing follows the current admin-configured cutoff and release schedule. Check the live payout page rather than relying on an old screenshot or message.',
      ],
      safetyNote: 'Hiroma staff should never ask for your password, Security PIN, passkey, or OTP in chat or a support ticket.',
      action: { label: 'Open Payouts', href: '/dashboard/reseller/payouts' },
    },
    {
      id: 'reconciliation-and-help', number: '08', title: 'Reconciling records and reporting a problem',
      summary: 'Use source ledgers and a complete evidence trail when a total appears incorrect.',
      points: [
        'Confirm the selected date range, transaction status, commission type, and member or order reference before comparing totals.',
        'Compare the summary card with its detailed ledger; use only records belonging to the same period and accounting stage.',
        'For an order issue, include the order reference. For an earning issue, include the commission type, date, amount, and triggering member or transaction.',
        'Attach a safe screenshot when helpful, but hide passwords, Security PINs, OTPs, passkeys, and full financial credentials.',
        'Ask Hiro for verified explanations. If the record still cannot be reconciled, create a Support Ticket for the Hiroma support team.',
      ],
      action: { label: 'Open Support Center', href: '/dashboard/reseller/support-center' },
    },
  ] satisfies OrdersAndEarningsLesson[],
  faqs: [
    { question: 'Why is my reseller price different from SRP?', answer: 'SRP is the public or non-member price. An authenticated reseller can receive the account-specific reseller price allowed by the current product and membership rules.' },
    { question: 'Can I cancel any order?', answer: 'You can directly cancel an order only while it is pending. Once fulfilment has started, contact the responsible distributor or Support Center for the correct process.' },
    { question: 'Why is total earned different from my available balance?', answer: 'Total earned is cumulative qualified income. Available balance reflects what remains available after releases, adjustments, pending or approved payouts, and other valid ledger movements.' },
    { question: 'When does commission become withdrawable?', answer: 'Only after a qualified earning is recorded in the wallet and remains in available balance under the current payout rules. Points, carryover, allocation, and flashout are not automatically withdrawable.' },
    { question: 'What is reserve or liability?', answer: 'It is qualified income that remains unpaid. It stays a liability until it is released or otherwise handled by an authorized accounting rule.' },
    { question: 'What is the difference between approved and paid?', answer: 'Approved means accepted but not yet released. Paid or released means the funds were actually released through the payout process.' },
    { question: 'What is flashout?', answer: 'Flashout is an amount or pair retained under an applicable package, rank, cap, package-difference, or inactivity rule. It is not included in payable balance.' },
    { question: 'Are carryover points or PU money?', answer: 'No. Carryover points and PU are unmatched network or product volume that may be used in future matching under the plan rules; they are not cash liability.' },
    { question: 'What do I need before requesting a payout?', answer: 'An approved payment method, enough available balance, no conflicting pending request, and a configured valid Security PIN. The live payout page shows the current policy.' },
    { question: 'When will my payout be released?', answer: 'Release follows the admin-configured cutoff and payout schedule plus request review. Use the live request status for the authoritative answer.' },
    { question: 'Can passkey or Face ID approve a payout?', answer: 'No. A passkey can simplify sign-in, but payouts and protected reseller payment-method changes still require the Security PIN.' },
    { question: 'What should I send when reporting an earning discrepancy?', answer: 'Provide the date range, commission type, amount, order or member reference, expected result, actual result, and a safe screenshot. Never include passwords, Security PINs, OTPs, or passkeys.' },
  ],
  quickChecks: [
    { question: 'Is an approved payout already paid?', answer: 'No. Approved is still unreleased; only released funds belong in Total Paid.' },
    { question: 'Is carryover a cash balance?', answer: 'No. It is unmatched volume that may support a future pair.' },
    { question: 'What does 2 PU left + 2 PU right create?', answer: 'One Product Binary pair, valued using the qualified rank rate at completion.' },
    { question: 'What protects payout submission?', answer: 'A configured and valid six-digit Security PIN, in addition to payout eligibility checks.' },
    { question: 'Where should flashout appear?', answer: 'In the report for its exact source: Direct Referral, Binary Commission, or Product Binary.' },
    { question: 'What is the first step in a discrepancy?', answer: 'Match the date range, status, source type, and detailed ledger before comparing the total.' },
  ],
}

export const ordersAndEarningsHiroKnowledge = [
  { id: 'orders-pricing', phrases: ['reseller price', 'srp difference', 'why price different', 'order pricing', 'presyo sa reseller'], answer: 'SRP is the public or non-member price. Your signed-in reseller account receives the price allowed by the current product and membership rules. Confirm the product, quantity, seller, and total inside Hiroma before paying.' },
  { id: 'orders-status', phrases: ['order status', 'pending order', 'processing order', 'ready for pickup', 'cancel my order', 'asa na akong order'], answer: 'Orders progress through pending, processing, ready for pickup when applicable, delivered, or cancelled. A reseller can directly cancel only a pending order; contact the responsible distributor or Support Center for a later-stage correction.' },
  { id: 'earnings-wallet', phrases: ['total earned versus balance', 'available balance', 'wallet difference', 'why balance different', 'unsa akong wallet'], answer: 'Total earned is cumulative qualified income, while available balance is what currently remains eligible under the wallet and payout rules. Approved payouts are not yet released, and only actually released funds count as paid.' },
  { id: 'earnings-sources', phrases: ['commission types', 'direct referral income', 'binary commission', 'product binary', 'where earnings come from'], answer: 'Hiroma separately records Direct Referral, Binary Commission, and Product Binary. Direct Referral comes from qualified registrations, Binary from payable left/right registration pairs, and Product Binary from 2 PU left plus 2 PU right using the qualified rank rate.' },
  { id: 'earnings-flashout', phrases: ['flashout meaning', 'daily cap', 'package difference', 'excess commission', 'ngano na flashout'], answer: 'Flashout is retained under an applicable rule and is not payable. It can come from a direct-referral cap or package difference, a Binary daily pair cap, or a Product Binary cap/inactivity rule. Reports must keep those sources separate.' },
  { id: 'earnings-carryover', phrases: ['carryover points', 'unmatched points', 'unpaired pu', 'is carryover money'], answer: 'Unmatched Binary points and unpaired Product Binary PU may carry forward under the plan rules. They are volume, not cash reserve, liability, or withdrawable balance.' },
  { id: 'payout-requirements', phrases: ['how to payout', 'payout requirements', 'minimum withdrawal', 'withdraw wallet', 'request payout'], answer: 'A payout request currently requires an approved payment method, at least PHP 500 available balance, no conflicting pending request, and a configured valid Security PIN. Processing follows the live admin-configured cutoff and release schedule.' },
  { id: 'earnings-discrepancy', phrases: ['wrong commission', 'missing earning', 'earning discrepancy', 'incorrect wallet', 'report payout problem'], answer: 'First match the date range, transaction status, commission source, and detailed ledger. If it still differs, create a Support Ticket with the date, type, amount, order/member reference, expected result, and a safe screenshot—never your password, PIN, OTP, or passkey.' },
] as const
