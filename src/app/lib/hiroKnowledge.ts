import { detectHiroLanguage, type HiroLanguage } from '@/app/lib/hiroLanguage'
import { gettingStartedHiroKnowledge } from '@/app/lib/learningCenter/gettingStarted'

export type HiroAccountContext = {
  fullName: string
  username: string
  memberId: string
  packageName: string
  rank: string
  points: number
  walletBalance: number
  totalEarned: number
  totalWithdrawn: number
  orderCounts: Record<string, number>
  pendingPayouts: number
  openTickets: number
  leftNetworkCount: number
  rightNetworkCount: number
  products: Array<{
    name: string
    description: string | null
    type: string
    srp: number
    resellerPrice: number
  }>
}

export type HiroReply = {
  answer: string
  links: Array<{ label: string; href: string }>
  matchedIntent: string
}

export type HiroConversationContext = {
  previousIntent?: string
  previousQuestion?: string
  language?: import('@/app/lib/hiroLanguage').HiroLanguage
}

type KnowledgeEntry = {
  id: string
  phrases: string[]
  answer: string | ((account: HiroAccountContext) => string)
  links?: HiroReply['links']
}

const money = (value: number) => new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
}).format(value)

const entries: KnowledgeEntry[] = [
  ...gettingStartedHiroKnowledge.map((entry) => ({
    ...entry,
    phrases: [...entry.phrases],
    links: [{ label: 'Open Getting Started course', href: '/dashboard/reseller/learning-center/getting-started' }],
  })),
  {
    id: 'greeting',
    phrases: ['hello', 'hi', 'hey', 'maayong adlaw', 'kumusta', 'kamusta', 'good morning', 'good afternoon'],
    answer: (account) => `Hello ${account.fullName}! Ako si Hiro, imong Hiroma Smart Assistant. Makapangutana ka bahin sa imong wallet, commissions, points, rank, orders, payouts, tickets, account security, ug Hiroma services.`,
  },
  {
    id: 'identity',
    phrases: ['kinsa ka', 'who are you', 'unsa ka', 'what can you do', 'unsa imong mahimo', 'help me'],
    answer: 'Ako si Hiro, ang built-in Hiroma Smart Assistant. Wala ko naggamit og external AI API. Ang akong tubag gikan sa verified Hiroma knowledge ug sa imong authorized account information.',
  },
  {
    id: 'company',
    phrases: ['unsa ning hiroma', 'what is hiroma', 'about hiroma', 'hiroma company', 'negosyo sa hiroma'],
    answer: 'Ang Hiroma usa ka product distribution ug member-network platform. Dinhi makamanage ang reseller sa products ug orders, network, commissions, wallet, payouts, account security, learning materials, ug support requests.',
    links: [{ label: 'Learning Center', href: '/dashboard/reseller/learning-center' }],
  },
  {
    id: 'wallet',
    phrases: [
      'wallet', 'wallet balance', 'balance', 'my balance', 'account balance', 'available balance',
      'how much my balance', 'how much is my balance', 'saldo', 'saldo ko', 'magkano balance ko',
      'magkano ang balance ko', 'kwarta nako', 'pila akong balance', 'pila ako balance',
      'pila ang akong balance', 'pila akong kwarta',
    ],
    answer: (account) => `Ang imong current wallet balance kay ${money(account.walletBalance)}. Total earned: ${money(account.totalEarned)}. Total released/withdrawn: ${money(account.totalWithdrawn)}.`,
    links: [{ label: 'Open Wallet', href: '/dashboard/reseller/wallet' }],
  },
  {
    id: 'profile',
    phrases: ['account', 'my account', 'account details', 'reseller account', 'profile', 'member id', 'my member id', 'username nako', 'my username', 'package nako', 'my package'],
    answer: (account) => `Account ni ${account.fullName} (@${account.username}). Member ID: ${account.memberId}. Package: ${account.packageName}.`,
    links: [{ label: 'View Digital ID', href: '/dashboard/reseller/digital-id' }],
  },
  {
    id: 'rank',
    phrases: ['rank', 'level', 'advancement', 'unsa akong rank', 'my rank', 'what is my rank', 'ano rank ko', 'promotion'],
    answer: (account) => `Ang imong current rank kay ${account.rank}, ug adunay kay ${account.points.toLocaleString()} points. Tan-awa ang Rank Advancement para sa progress ug requirements.`,
    links: [{ label: 'Rank Advancement', href: '/dashboard/reseller/points' }],
  },
  {
    id: 'points',
    phrases: ['points', 'my points', 'puntos', 'pila akong points', 'magkano points ko', 'how many points', 'total points', 'binary points'],
    answer: (account) => `Ang imong recorded total points kay ${account.points.toLocaleString()} points. Ang left/right network details makita sa Binary Tree ug Rank Advancement.`,
    links: [
      { label: 'Binary Tree', href: '/dashboard/reseller/tree' },
      { label: 'Rank Advancement', href: '/dashboard/reseller/points' },
    ],
  },
  {
    id: 'orders',
    phrases: ['order', 'orders', 'my order', 'my orders', 'palit', 'delivery', 'pending order', 'asa akong order', 'nasaan order ko', 'where is my order', 'order status'],
    answer: (account) => `Naa kay ${account.orderCounts.total || 0} total orders: ${account.orderCounts.pending || 0} pending, ${account.orderCounts.processing || 0} processing, ${account.orderCounts.ready_for_pickup || 0} ready for pickup, ug ${account.orderCounts.delivered || 0} delivered.`,
    links: [{ label: 'View My Orders', href: '/dashboard/reseller/orders' }],
  },
  {
    id: 'payout',
    phrases: ['payout', 'my payout', 'withdraw', 'withdrawal', 'cash out', 'release', 'kuha kwarta', 'pending payout', 'payout status', 'nasaan payout ko'],
    answer: (account) => account.pendingPayouts > 0
      ? `Aduna kay ${account.pendingPayouts} pending payout request. Mahimo nimong tan-awon ang cutoff, payout date, ug status sa Payouts page.`
      : 'Wala kay pending payout request karon. Ang payout request kinahanglan adunay approved payment method, sufficient balance, ug Security PIN confirmation.',
    links: [{ label: 'Open Payouts', href: '/dashboard/reseller/payouts' }],
  },
  {
    id: 'commission',
    phrases: ['commission', 'my commission', 'income', 'my income', 'earnings', 'my earnings', 'direct referral', 'binary commission', 'bonus', 'kita', 'how much i earned', 'magkano kinita ko'],
    answer: 'Ang Hiroma earnings mahimong gikan sa eligible direct referral, binary pairing, ug ubang enabled commission programs. Ang exact credited transactions makita sa Wallet commission history; only recorded credits count as member earnings.',
    links: [{ label: 'Commission History', href: '/dashboard/reseller/wallet' }],
  },
  {
    id: 'direct-referral',
    phrases: ['direct referral', 'referral bonus', 'sponsor bonus', 'invite income', 'refer member'],
    answer: 'Ang direct-referral credit mahimong ma-create kung eligible ang sponsor, active ang relevant package rule, ug successful ang qualifying registration. Ang amount ug cap mosunod sa configured package rules; ang official credited amount makita sa Wallet history.',
    links: [{ label: 'Commission History', href: '/dashboard/reseller/wallet' }, { label: 'Commission Lessons', href: '/dashboard/reseller/learning-center' }],
  },
  {
    id: 'binary-commission',
    phrases: ['binary pair', 'pairing', 'left right pair', 'binary income', 'carry over', 'flashout'],
    answer: 'Sa binary commission, qualifying volume sa left ug right side ma-match sumala sa current package rules. Unmatched eligible volume mahimong carry-over, samtang excess over an enabled daily cap mahimong flashout. Ang actual credited income ug points mao ang authoritative record.',
    links: [{ label: 'View Binary Tree', href: '/dashboard/reseller/tree' }, { label: 'Commission History', href: '/dashboard/reseller/wallet' }],
  },
  {
    id: 'product-binary',
    phrases: ['product binary', 'product unit', 'pu', 'two products left', 'product pair', 'rank pair rate'],
    answer: 'Ang Product Binary usa ka product-purchase pairing program: eligible Product Units gikan sa left ug right network ma-match base sa configured rule, ug ang pair value mahimong magdepende sa qualified rank. Only completed and recorded pairs create member earnings.',
    links: [{ label: 'Learning Center', href: '/dashboard/reseller/learning-center' }],
  },
  {
    id: 'packages',
    phrases: ['package', 'starter package', 'silver package', 'gold package', 'upgrade package', 'package benefits', 'package cap'],
    answer: (account) => `Ang imong current package kay ${account.packageName}. Ang referral value, binary value, points, ug daily caps mahimong lahi matag package ug mosunod sa active company configuration. Para sa exact upgrade requirements, gamita ang official package or support information.`,
    links: [{ label: 'Rank Advancement', href: '/dashboard/reseller/points' }, { label: 'Ask Support', href: '/dashboard/reseller/support-center' }],
  },
  {
    id: 'network-stats',
    phrases: [
      'left leg', 'right leg', 'left network', 'right network', 'left downline', 'right downline',
      'left affiliates', 'right affiliates', 'pila akong left', 'pila akong right',
      'how many in my left', 'how many in my right', 'total downlines', 'network count',
    ],
    answer: (account) => `Sa imong binary network, adunay ${account.leftNetworkCount.toLocaleString()} members sa left leg ug ${account.rightNetworkCount.toLocaleString()} members sa right leg. Total network placement count: ${(account.leftNetworkCount + account.rightNetworkCount).toLocaleString()}.`,
    links: [
      { label: 'View Binary Tree', href: '/dashboard/reseller/tree' },
      { label: 'View Affiliates', href: '/dashboard/reseller/genealogy' },
    ],
  },
  {
    id: 'network',
    phrases: ['network', 'downline', 'upline', 'sponsor', 'binary tree', 'affiliates', 'referral'],
    answer: 'Ang Binary Tree nagpakita sa left ug right placement network. Ang Affiliates naglista sa imong network members. Ang sponsor/referrer ug binary placement mahimong magkalahi depende sa registration placement.',
    links: [
      { label: 'Binary Tree', href: '/dashboard/reseller/tree' },
      { label: 'Affiliates', href: '/dashboard/reseller/genealogy' },
    ],
  },
  {
    id: 'security',
    phrases: ['security', 'password', 'pin', 'fingerprint', 'face id', 'passkey', 'register device', 'login'],
    answer: 'Sa account security, ang password mao ang recovery fallback. Ang registered device mahimong mogamit og Face ID, fingerprint, Windows Hello, o device unlock isip passkey. Ang Security PIN required gihapon sa payouts ug sensitive account actions.',
    links: [{ label: 'Security Settings', href: '/dashboard/reseller/settings' }],
  },
  {
    id: 'digital-id',
    phrases: ['digital id', 'member qr', 'qr code', 'scan member', 'member identity', 'verify member'],
    answer: 'Ang Digital ID ug member QR gigamit sa pag-identify ug pag-verify sa reseller. Sa supported distributor order flow, ang scan makatabang pag-load sa correct member details ug applicable reseller pricing. Ayaw ipa-share ang account password o Security PIN.',
    links: [{ label: 'View Digital ID', href: '/dashboard/reseller/digital-id' }],
  },
  {
    id: 'registration',
    phrases: ['register reseller', 'registration', 'join hiroma', 'new member', 'activation pin', 'starter package'],
    answer: 'Ang new reseller registration ug starter-package activation gi-process pinaagi sa authorized city distributor. Kinahanglan accurate ang legal identity ug contact details, valid package/PIN, ug correct sponsor ug binary placement before confirmation.',
    links: [{ label: 'Learning Center', href: '/dashboard/reseller/learning-center' }],
  },
  {
    id: 'pricing',
    phrases: ['reseller price', 'srp', 'non member price', 'member price', 'discount', 'wholesale price'],
    answer: 'Ang SRP mao ang standard non-member selling price. Ang reseller price applicable lamang sa identified and eligible member, subject sa current catalog. Sa walk-in order, i-scan o i-select ang correct reseller before adding products aron malikayan ang wrong pricing.',
    links: [{ label: 'View Products / Orders', href: '/dashboard/reseller/orders' }],
  },
  {
    id: 'payment-method',
    phrases: ['payment method', 'gcash', 'bank account', 'payout account', 'change payment', 'approved payment'],
    answer: 'Ang payout payment method kinahanglan sakto, verified, ug approved. Ang pag-add o pagtangtang niini usa ka sensitive action nga nanginahanglan Security PIN. Ayaw ihatag kang Hiro ang complete account number, OTP, password, o PIN.',
    links: [{ label: 'Payment Method', href: '/dashboard/reseller/payment-method' }, { label: 'Security Settings', href: '/dashboard/reseller/settings' }],
  },
  {
    id: 'marketing',
    phrases: ['marketing center', 'marketing materials', 'poster', 'social media', 'promote product', 'selling guide'],
    answer: 'Ang Marketing Center para sa authorized Hiroma promotional resources. Gamita ang current product facts ug approved claims; likayi ang misleading income guarantees, medical claims, o altered pricing information.',
    links: [{ label: 'Marketing Center', href: '/dashboard/reseller/marketing-center' }],
  },
  {
    id: 'tickets',
    phrases: ['ticket', 'my ticket', 'support', 'problema', 'issue', 'complaint', 'concern', 'tabang', 'ticket status', 'support request'],
    answer: (account) => `Aduna kay ${account.openTickets} active support ticket${account.openTickets === 1 ? '' : 's'}. Kung wala ni Hiro ang confirmed answer, paghimo og ticket aron matubag sa Hiroma support team.`,
    links: [{ label: 'Support Center', href: '/dashboard/reseller/support-center' }],
  },
  {
    id: 'learning',
    phrases: ['learning center', 'academy', 'training', 'tutorial', 'system guide', 'company guide'],
    answer: 'Ang Learning Center mao ang official area para sa Hiroma system guides, product education, responsible selling, account security, ug commission lessons.',
    links: [{ label: 'Learning Center', href: '/dashboard/reseller/learning-center' }],
  },
]

const productTopicPattern = /\b(product|products|produkto|perfume|perfumes|pabango|fragrance|scent|srp|reseller price|catalog)\b/
const productPricePattern = /\b(price|presyo|pila|how much|available)\b/

function answerProductQuestion(normalized: string, account: HiroAccountContext): HiroReply | null {
  const genericTokens = new Set(['hiroma', 'perfume', 'perfumes', 'product', 'products', 'produkto', 'pabango', 'fragrance', 'ml'])
  const questionTokens = new Set(normalized.split(' ').filter((token) => token.length > 1 && !genericTokens.has(token)))
  const ranked = account.products.map((product) => {
    const productName = normalizeHiroQuestion(product.name)
    const productTokens = productName.split(' ').filter((token) => token.length > 1 && !genericTokens.has(token))
    const exact = normalized.includes(productName) ? 100 : 0
    const overlap = productTokens.filter((token) => questionTokens.has(token)).length
    return { product, score: exact + overlap }
  }).sort((a, b) => b.score - a.score)

  const selected = ranked[0]?.score > 0 ? ranked[0].product : null
  if (!productTopicPattern.test(normalized) && !(productPricePattern.test(normalized) && selected)) return null
  if (selected) {
    const description = /\b(unsa|about|description|amoy|scent|smell)\b/.test(normalized) && selected.description
      ? ` ${selected.description}`
      : ''
    return {
      matchedIntent: 'products',
      answer: `${selected.name}: SRP ${money(selected.srp)}; current reseller price ${money(selected.resellerPrice)}.${description}`,
      links: [{ label: 'View Products / Orders', href: '/dashboard/reseller/orders' }],
    }
  }

  if (account.products.length > 0) {
    const catalog = account.products.slice(0, 8)
      .map((product) => `${product.name} (${money(product.srp)} SRP)`)
      .join(', ')
    return {
      matchedIntent: 'products',
      answer: `Mao ni ang active products sa Hiroma catalog karon: ${catalog}. Isulti lang ang exact product name kung gusto nimo ang reseller price o detalye.`,
      links: [{ label: 'View Products / Orders', href: '/dashboard/reseller/orders' }],
    }
  }

  return {
    matchedIntent: 'products',
    answer: 'Wala koy nakitang active product sa verified catalog karon. Palihug i-check ang Orders page o contact support.',
    links: [
      { label: 'View Products / Orders', href: '/dashboard/reseller/orders' },
      { label: 'Contact Support', href: '/dashboard/reseller/support-center' },
    ],
  }
}

const casualReplies: Array<{ phrases: string[]; answer: (account: HiroAccountContext) => string }> = [
  { phrases: ['salamat', 'thank you', 'thanks', 'ty'], answer: () => 'Walay sapayan! Naa ra ko diri kung naa pa kay gusto ipangutana. 😊' },
  { phrases: ['mao ba', 'ah okay', 'okay', 'sige', 'gets', 'nakasabot ko'], answer: () => 'Yes, mao na siya. Gusto nimo nga akong i-explain pa, o naa kay sunod nga pangutana?' },
  { phrases: ['haha', 'hehe', 'lol'], answer: () => 'Haha! 😄 Naa ra gyud ko diri. Unsa pa man atong tan-awon sa imong Hiroma account?' },
  { phrases: ['kumusta ka', 'how are you', 'okay ra ka'], answer: () => 'Okay kaayo ko ug ready motabang! Kumusta pud ka? Pwede nato tan-awon imong wallet, orders, rank, points, o payouts.' },
  { phrases: ['kinsa ko', 'who am i', 'ako kinsa'], answer: (account) => `Ikaw si ${account.fullName}, ang Hiroma member nga adunay username @${account.username} ug Member ID ${account.memberId}.` },
]

const aliases: Record<string, string> = {
  kwarta: 'wallet money balance',
  bayad: 'payment payout',
  sweldo: 'commission earnings payout',
  ranggo: 'rank level',
  ordera: 'order',
  problema: 'support issue',
  tabangi: 'help support',
  unsaon: 'how to guide',
  balanse: 'balance',
  saldo: 'balance wallet',
  kinita: 'earnings commission',
  kitaon: 'earnings commission',
  puntos: 'points',
}

export function normalizeHiroQuestion(input: string): string {
  const base = input.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  return base.split(' ').map((word) => `${word} ${aliases[word] || ''}`.trim()).join(' ')
}

export function answerHiroQuestion(question: string, account: HiroAccountContext, conversation: HiroConversationContext = {}): HiroReply {
  const language = conversation.language || detectHiroLanguage(question)
  const normalized = normalizeHiroQuestion(question)
  const tokens = new Set(normalized.split(' ').filter(Boolean))
  const intentStopWords = new Set([
    'a', 'an', 'ang', 'ako', 'akong', 'and', 'are', 'ba', 'how', 'i', 'is', 'ko', 'mo',
    'my', 'na', 'ng', 'nako', 'ni', 'of', 'pila', 'sa', 'the', 'what', 'where', 'why', 'your',
  ])

  const priorityIntent = /\bdirect referral\b/.test(normalized)
    ? 'direct-referral'
    : /\b(left|right)\s+(leg|network|downline|affiliate|affiliates)\b|\b(network count|total downlines)\b/.test(normalized)
      ? 'network-stats'
    : /\b(srp).*(reseller price)|\b(reseller price).*(srp)|\b(non member price|member price|wholesale price)\b/.test(normalized)
      ? 'pricing'
      : null
  if (priorityIntent) {
    const entry = entries.find((candidate) => candidate.id === priorityIntent)
    if (entry) {
      return localizeHiroReply({
        matchedIntent: entry.id,
        answer: typeof entry.answer === 'function' ? entry.answer(account) : entry.answer,
        links: entry.links || [],
      }, language, account)
    }
  }

  const productReply = answerProductQuestion(normalized, account)
  if (productReply) return localizeHiroReply(productReply, language, account)

  for (const casual of casualReplies) {
    if (casual.phrases.some((phrase) => normalized.includes(normalizeHiroQuestion(phrase)))) {
      return localizeHiroReply({ matchedIntent: 'conversation', answer: casual.answer(account), links: [] }, language, account)
    }
  }

  let best: { entry: KnowledgeEntry; score: number } | null = null

  for (const entry of entries) {
    let score = 0
    for (const phrase of entry.phrases) {
      const normalizedPhrase = normalizeHiroQuestion(phrase)
      if (normalized.includes(normalizedPhrase)) score += normalizedPhrase.includes(' ') ? 8 : 5
      if (entry.id !== 'company') {
        for (const token of normalizedPhrase.split(' ')) {
          if (!intentStopWords.has(token) && token.length > 1 && tokens.has(token)) score += 1
        }
      }
    }
    if (!best || score > best.score) best = { entry, score }
  }

  // A new explicit account question must always override the previous conversation topic.
  // Continuation is only used when the current message has no independently recognizable intent.
  if (best && best.score >= 2) {
    return localizeHiroReply({
      matchedIntent: best.entry.id,
      answer: typeof best.entry.answer === 'function' ? best.entry.answer(account) : best.entry.answer,
      links: best.entry.links || [],
    }, language, account)
  }

  const shortFollowUp = tokens.size <= 5 && /^(pila gani|unsa pa|how about that|what about that|tell me more|explain more|padayon|continue|unya|ngano man|kanus a|asa gani)/.test(normalized)
  const contextualEntry = shortFollowUp ? entries.find((entry) => entry.id === conversation.previousIntent) : undefined
  if (contextualEntry) {
    const answer = typeof contextualEntry.answer === 'function' ? contextualEntry.answer(account) : contextualEntry.answer
    return localizeHiroReply({ matchedIntent: contextualEntry.id, answer, links: contextualEntry.links || [] }, language, account)
  }

  if (!best || best.score < 2) {
    return localizeHiroReply({
      matchedIntent: 'fallback',
      answer: 'Hmm, gusto ko masabtan gyud imong pasabot. Bahin ba ni sa imong account, wallet, order, payout, commission, network, security, o Hiroma guide? Pwede nimo isulti sa lain nga paagi—pananglitan, “pila akong balance?” o “asa na akong order?”',
      links: [
        { label: 'Browse Learning Center', href: '/dashboard/reseller/learning-center' },
        { label: 'Create Support Ticket', href: '/dashboard/reseller/support-center' },
      ],
    }, language, account)
  }

  return { matchedIntent: 'fallback', answer: 'Wala koy verified answer para ana nga pangutana.', links: [] }
}

function localizeHiroReply(reply: HiroReply, language: HiroLanguage, account: HiroAccountContext): HiroReply {
  const count = account.orderCounts
  const en: Record<string, string> = {
    greeting: `Hello ${account.fullName}! I am Hiro, your Hiroma Smart Assistant. Ask me about your account, wallet, commissions, points, rank, orders, payouts, security, products, or Hiroma services.`,
    identity: 'I am Hiro, Hiroma\'s built-in Smart Assistant. I answer using verified Hiroma knowledge and account information you are authorized to view.',
    company: 'Hiroma is a product distribution and member network platform for products, orders, networks, commissions, wallets, payouts, learning, security, and support.',
    wallet: `Your current wallet balance is ${money(account.walletBalance)}. Total earned: ${money(account.totalEarned)}. Total released or withdrawn: ${money(account.totalWithdrawn)}.`,
    profile: `This account belongs to ${account.fullName} (@${account.username}). Member ID: ${account.memberId}. Package: ${account.packageName}.`,
    rank: `Your current rank is ${account.rank}, with ${account.points.toLocaleString()} points.`,
    points: `You currently have ${account.points.toLocaleString()} recorded points. Open Binary Tree or Rank Advancement for the detailed breakdown.`,
    orders: `You have ${count.total || 0} total orders: ${count.pending || 0} pending, ${count.processing || 0} processing, ${count.ready_for_pickup || 0} ready for pickup, and ${count.delivered || 0} delivered.`,
    payout: account.pendingPayouts ? `You have ${account.pendingPayouts} pending payout request${account.pendingPayouts === 1 ? '' : 's'}.` : 'You have no pending payout request. A payout requires an approved payment method, sufficient balance, and Security PIN confirmation.',
    'network-stats': `Your binary network has ${account.leftNetworkCount.toLocaleString()} members on the left leg and ${account.rightNetworkCount.toLocaleString()} on the right leg.`,
    tickets: `You have ${account.openTickets} active support ticket${account.openTickets === 1 ? '' : 's'}.`,
    security: 'Your password remains the recovery method. A registered device may use Face ID, fingerprint, Windows Hello, or device unlock. Your Security PIN is still required for payouts and sensitive actions.',
    learning: 'The Learning Center contains verified Hiroma guides, product education, responsible-selling guidance, account security, and commission lessons.',
    commission: 'Eligible earnings may come from direct referrals, binary pairing, and other enabled programs. Your Wallet commission history is the authoritative record.',
    'direct-referral': 'An eligible direct-referral credit follows the configured package rules, active sponsor, referral value, and daily cap. The credited amount in your Wallet is the official record.',
    'binary-commission': 'Binary commission matches qualifying left and right volume under the active package rules. Unmatched eligible volume may carry over, while excess above an enabled daily cap may flash out.',
    'product-binary': 'Product Binary matches eligible Product Units from the left and right network. Completed pairs use the member’s qualified rank rate and only recorded pairs create earnings.',
    packages: `Your current package is ${account.packageName}. Referral values, binary values, points, and daily caps follow the active package configuration.`,
    network: 'Binary Tree shows left and right placement. Affiliates lists your network members. A sponsor relationship and binary placement can be different.',
    'digital-id': 'Your Digital ID and member QR identify and verify your reseller account. Never share your password or Security PIN.',
    registration: 'New reseller registration and package activation are handled by an authorized city distributor using accurate identity, package/PIN, sponsor, and placement information.',
    pricing: 'SRP is the standard non-member price. Reseller pricing applies only to an identified eligible member and follows the current product catalog.',
    'payment-method': 'A payout payment method must be accurate, verified, and approved. Adding or removing one requires your Security PIN. Never share your OTP, password, or PIN.',
    marketing: 'The Marketing Center contains authorized promotional resources. Use current product facts and avoid misleading income guarantees, medical claims, or altered prices.',
    products: account.products.length ? `These are the active Hiroma products: ${account.products.slice(0, 8).map((product) => `${product.name} (SRP ${money(product.srp)}; reseller ${money(product.resellerPrice)})`).join(', ')}.` : 'There are no active products in the catalog right now.',
    conversation: 'I am here to help. Ask me about your Hiroma account or services.',
    fallback: 'I do not have verified information that answers your question. Would you like me to create a support ticket for you? Reply Yes or No.',
  }
  const tl: Record<string, string> = {
    greeting: `Kumusta ${account.fullName}! Ako si Hiro, ang iyong Hiroma Smart Assistant. Maaari mo akong tanungin tungkol sa account, wallet, commissions, points, rank, orders, payouts, security, products, o Hiroma services.`,
    identity: 'Ako si Hiro, ang built-in Smart Assistant ng Hiroma. Ang sagot ko ay mula sa verified Hiroma knowledge at sa account information na awtorisado mong makita.',
    company: 'Ang Hiroma ay product-distribution at member-network platform para sa products, orders, network, commissions, wallet, payouts, learning, security, at support.',
    wallet: `Ang current wallet balance mo ay ${money(account.walletBalance)}. Total earned: ${money(account.totalEarned)}. Total released o withdrawn: ${money(account.totalWithdrawn)}.`,
    profile: `Ang account na ito ay kay ${account.fullName} (@${account.username}). Member ID: ${account.memberId}. Package: ${account.packageName}.`,
    rank: `Ang current rank mo ay ${account.rank}, at mayroon kang ${account.points.toLocaleString()} points.`,
    points: `Mayroon kang ${account.points.toLocaleString()} recorded points. Buksan ang Binary Tree o Rank Advancement para sa detalye.`,
    orders: `Mayroon kang ${count.total || 0} total orders: ${count.pending || 0} pending, ${count.processing || 0} processing, ${count.ready_for_pickup || 0} ready for pickup, at ${count.delivered || 0} delivered.`,
    payout: account.pendingPayouts ? `Mayroon kang ${account.pendingPayouts} pending payout request.` : 'Wala kang pending payout request. Kailangan ng approved payment method, sapat na balance, at Security PIN confirmation.',
    'network-stats': `Mayroon kang ${account.leftNetworkCount.toLocaleString()} members sa left leg at ${account.rightNetworkCount.toLocaleString()} sa right leg.`,
    tickets: `Mayroon kang ${account.openTickets} active support ticket${account.openTickets === 1 ? '' : 's'}.`,
    security: 'Ang password ang recovery method mo. Maaaring gumamit ang registered device ng Face ID, fingerprint, Windows Hello, o device unlock. Kailangan pa rin ang Security PIN sa payouts at sensitive actions.',
    learning: 'Nasa Learning Center ang verified Hiroma guides, product education, responsible selling, account security, at commission lessons.',
    commission: 'Ang eligible earnings ay maaaring galing sa direct referral, binary pairing, at iba pang enabled programs. Ang Wallet commission history ang official record.',
    'direct-referral': 'Ang eligible direct-referral credit ay sumusunod sa active sponsor, package value, at daily-cap rules. Ang credited amount sa Wallet ang official record.',
    'binary-commission': 'Sa binary commission, mina-match ang qualifying left at right volume ayon sa active package rules. Maaaring mag-carry over ang unmatched eligible volume at mag-flashout ang excess sa daily cap.',
    'product-binary': 'Sa Product Binary, mina-match ang eligible Product Units mula sa left at right network. Ang completed pairs ay gumagamit ng qualified rank rate.',
    packages: `Ang current package mo ay ${account.packageName}. Ang referral values, binary values, points, at daily caps ay ayon sa active configuration.`,
    network: 'Makikita sa Binary Tree ang left at right placement. Nakalista sa Affiliates ang network members mo.',
    'digital-id': 'Ginagamit ang Digital ID at member QR para kilalanin at i-verify ang reseller account. Huwag ibahagi ang password o Security PIN.',
    registration: 'Ang new reseller registration at package activation ay pinoproseso ng authorized city distributor gamit ang tamang identity, package/PIN, sponsor, at placement.',
    pricing: 'Ang SRP ang standard non-member price. Ang reseller price ay para lamang sa verified eligible member at sumusunod sa current catalog.',
    'payment-method': 'Kailangang tama, verified, at approved ang payout payment method. Kailangan ang Security PIN sa pag-add o remove nito.',
    marketing: 'Nasa Marketing Center ang authorized promotional resources. Gumamit lamang ng current product facts at approved claims.',
    products: account.products.length ? `Ito ang active Hiroma products: ${account.products.slice(0, 8).map((product) => `${product.name} (SRP ${money(product.srp)}; reseller ${money(product.resellerPrice)})`).join(', ')}.` : 'Walang active products sa catalog ngayon.',
    conversation: 'Narito ako para tumulong. Magtanong tungkol sa iyong Hiroma account o services.',
    fallback: 'Wala akong verified information para masagot nang tama ang tanong mo. Gusto mo bang gumawa ako ng support ticket para sa iyo? Sumagot ng Oo o Hindi.',
  }
  const ceb: Record<string, string> = {
    fallback: 'Wala koy verified information nga makatubag sa imong pangutana. Gusto ba nimo nga maghimo ko og support ticket para nimo? Tubag og Oo o Dili.',
  }
  const table = language === 'tl' ? tl : language === 'ceb' ? ceb : en
  return { ...reply, answer: table[reply.matchedIntent] || (language === 'ceb' ? reply.answer : en[reply.matchedIntent] || reply.answer) }
}
