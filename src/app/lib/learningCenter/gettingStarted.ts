export type GettingStartedLesson = {
  id: string
  number: string
  title: string
  summary: string
  points: string[]
  safetyNote?: string
  action?: { label: string; href: string }
}

export const gettingStartedCourse = {
  title: 'Getting Started with Hiroma',
  description: 'A verified orientation to your reseller account, dashboard, Digital ID, security controls, and support tools.',
  estimatedMinutes: 20,
  lessons: [
    {
      id: 'account',
      number: '01',
      title: 'Know your reseller account',
      summary: 'Your Hiroma account is your personal access to the reseller system and should only be used by you.',
      points: [
        'Your username identifies your account when you sign in. Your full name, member ID, package, sponsor, and registration date are shown in authorized parts of the dashboard.',
        'A member ID is assigned after activation. If activation is still pending, some identity features, including the final Digital ID and verification QR, may not yet be available.',
        'Your package, rank, points, commissions, wallet activity, orders, and network information belong to your account and can change as verified transactions are recorded.',
        'Use the Profile and Security Settings areas to keep your account information and sign-in methods current.',
      ],
      safetyNote: 'Never allow another person to operate your account or share your password, Security PIN, OTP, or recovery link.',
      action: { label: 'Open account settings', href: '/dashboard/reseller/settings' },
    },
    {
      id: 'sign-in',
      number: '02',
      title: 'Sign in and recover access safely',
      summary: 'Hiroma supports password sign-in and, when registered, Face ID, fingerprint, or device-unlock sign-in through a passkey.',
      points: [
        'Standard sign-in uses your username and password. If your account requires a Security PIN at login, enter the six-digit PIN only on the official Hiroma page.',
        'Face ID / Fingerprint Login is optional. Register a trusted device from Security Settings using your current password, then use the biometric or device-unlock method supported by that device.',
        'A successful passkey sign-in replaces only the login PIN step. Sensitive actions such as payout requests and reseller payment-method changes still require the configured Security PIN.',
        'If you cannot use a registered device, sign in with your password. A completed password-recovery reset removes registered passkeys so they can be registered again safely.',
      ],
      safetyNote: 'Use Face ID or fingerprint only on a device you control. Avoid registering shared computers or internet-cafe devices.',
      action: { label: 'Review security settings', href: '/dashboard/reseller/settings' },
    },
    {
      id: 'dashboard',
      number: '03',
      title: 'Read your dashboard',
      summary: 'The dashboard is a verified overview of your current reseller activity, not a promise of future earnings.',
      points: [
        'Wallet cards summarize recorded balance and earnings. Open Wallet for the detailed ledger and Payouts for withdrawal requests and their status.',
        'Network cards show your left and right affiliates. Binary Tree and Affiliates provide the detailed network views.',
        'Points and rank-progress information show recorded qualification progress. Rank Advancement contains the detailed requirements available to your account.',
        'Order and commission summaries reflect recorded system transactions. Use the destination page or ledger when you need the complete breakdown.',
        'Hiro Business Coach can explain verified dashboard signals and suggest practical next steps, but its guidance does not guarantee sales, commissions, or rank advancement.',
      ],
      action: { label: 'Open dashboard', href: '/dashboard/reseller' },
    },
    {
      id: 'digital-id',
      number: '04',
      title: 'Use your Digital ID and QR code',
      summary: 'Your Digital ID is the official in-system identity card for your activated Hiroma membership.',
      points: [
        'The card displays verified account details such as member ID, full name, username, registration date, member type, and sponsor information.',
        'The QR code opens the member-verification page for your member ID. It helps an authorized user confirm that the membership record exists.',
        'You can enlarge the ID or QR code and download the ID image from the Digital ID page.',
        'A verification QR confirms membership information; it is not a password, payment approval, or guarantee of income.',
      ],
      safetyNote: 'Share the ID or QR only when membership verification is genuinely needed. Do not publish other private account or payment information with it.',
      action: { label: 'Open Digital ID', href: '/dashboard/reseller/digital-id' },
    },
    {
      id: 'security',
      number: '05',
      title: 'Protect your account',
      summary: 'Use separate layers for sign-in, device access, and sensitive financial actions.',
      points: [
        'Your password protects normal account access. Use a unique password and change it immediately if you suspect it was exposed.',
        'Your six-digit Security PIN protects login when enabled and is always required by protected reseller payout and payment-method operations.',
        'Face ID, fingerprint, or device unlock is stored as a passkey credential by the device or passkey provider. Hiroma does not receive a copy of your fingerprint or face scan.',
        'You may register more than one trusted device and remove a device from Security Settings after confirming your current password.',
        'Review unexpected account activity and contact Support immediately if you see an unfamiliar device, payout, payment method, or order.',
      ],
      safetyNote: 'Hiroma support should never ask you to reveal your password, complete Security PIN, OTP, or passkey biometric data.',
      action: { label: 'Manage account security', href: '/dashboard/reseller/settings' },
    },
    {
      id: 'help',
      number: '06',
      title: 'Know where to get help',
      summary: 'Use the right area for verified information, learning, and unresolved problems.',
      points: [
        'Ask Hiro for verified account summaries and explanations of the Hiroma system. Hiro uses authorized account data and approved knowledge, not an external AI service.',
        'Use the Learning Center for official guides and future product, order, earnings, and business lessons.',
        'Create a Support Ticket when Hiro cannot verify an answer or when an account, order, payout, security, or website problem needs staff assistance.',
        'Support tickets keep their conversation and status. A resolved ticket is permanently closed and cannot return to Open or In Progress.',
      ],
      action: { label: 'Open Support Center', href: '/dashboard/reseller/support-center' },
    },
  ] satisfies GettingStartedLesson[],
  faqs: [
    { question: 'Is the Digital ID a replacement for my password?', answer: 'No. The Digital ID and QR are for membership identification and verification. They cannot sign in to your account or approve a sensitive transaction.' },
    { question: 'Can I use Face ID or fingerprint on another device?', answer: 'Yes, if that device supports passkeys and you register it from your Security Settings using your current password. Register only devices you control.' },
    { question: 'Why do I still need a Security PIN after using a passkey?', answer: 'A passkey can replace the PIN step at login, but the Security PIN remains a separate confirmation for protected payouts and reseller payment-method changes.' },
    { question: 'Where can I verify my detailed balance or transaction?', answer: 'Open the corresponding Wallet, Payouts, Orders, Commission, or network page. Dashboard cards are summaries; the detailed page is the proper audit view.' },
    { question: 'What should I do if Hiro cannot answer?', answer: 'Ask Hiro to create or guide you to a Support Ticket. Include the relevant reference number and a clear description, but never include your password, PIN, or OTP.' },
  ],
  quickChecks: [
    { question: 'Should you share your Security PIN with support?', answer: 'No. Your password, Security PIN, OTP, and recovery links must remain private.' },
    { question: 'Does a Digital ID QR approve a payout?', answer: 'No. It verifies membership information only.' },
    { question: 'Where should an unresolved account problem go?', answer: 'Create a Support Ticket so authorized staff can review it.' },
  ],
}

export const gettingStartedHiroKnowledge = [
  {
    id: 'getting-started-account',
    phrases: ['getting started', 'start using hiroma', 'how my account works', 'account orientation', 'new reseller guide', 'unsaon paggamit account'],
    answer: 'Your Hiroma reseller account gives you access to your dashboard, network, wallet, orders, Digital ID, security controls, learning materials, Hiro, and Support Center. Start by confirming your profile, reviewing your dashboard, opening your Digital ID, and securing the account with a password, Security PIN, and optional trusted-device passkey.',
  },
  {
    id: 'getting-started-dashboard',
    phrases: ['how dashboard works', 'dashboard guide', 'understand dashboard', 'unsa ang dashboard', 'dashboard cards'],
    answer: 'Your dashboard is a verified summary of recorded account activity: wallet and earnings, points and rank progress, left/right network counts, orders, and commissions. Open the related destination page for the detailed ledger or breakdown. Dashboard information is not a guarantee of future earnings.',
  },
  {
    id: 'getting-started-digital-id',
    phrases: ['digital id guide', 'how digital id works', 'what is qr on id', 'member verification qr', 'unsa digital id'],
    answer: 'Your Digital ID shows verified membership details after activation. Its QR opens your member-verification page. You can enlarge or download the ID, but the ID and QR cannot sign in, approve payments, or guarantee income.',
  },
  {
    id: 'getting-started-security',
    phrases: ['security settings guide', 'protect my account', 'password pin passkey difference', 'face id fingerprint guide', 'how passkey works'],
    answer: 'Your password protects account access; the six-digit Security PIN protects login when enabled and protected financial actions; an optional passkey lets a trusted device use Face ID, fingerprint, or device unlock. Passkey login bypasses only the login PIN—protected payouts and reseller payment-method changes still require the Security PIN.',
  },
  {
    id: 'getting-started-help',
    phrases: ['where to get help', 'hiro cannot answer', 'need support', 'learning center guide', 'create support ticket'],
    answer: 'Use Hiro for verified account summaries and system explanations, the Learning Center for official guides, and the Support Center for unresolved account, order, payout, security, or website problems. Never include your password, Security PIN, or OTP in a ticket.',
  },
] as const
