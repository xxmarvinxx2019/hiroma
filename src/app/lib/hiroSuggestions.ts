type SuggestionMessage = {
  role: 'hiro' | 'user' | 'system'
  intent?: string
  text: string
}

import { detectHiroLanguage, type HiroLanguage } from '@/app/lib/hiroLanguage'

const CEB_GENERAL_SUGGESTIONS = [
  'Pila akong wallet balance?',
  'Unsa akong rank ug points?',
  'Asa na akong orders?',
  'Naa ba koy pending payout?',
  'Pila akong left ug right network?',
  'Unsa akong current package?',
  'Unsa inyong available perfumes?',
  'Pila akong active support tickets?',
  'Unsaon pag-secure sa akong account?',
  'Unsaon pag-earn sa direct referral?',
  'Giunsa pag-work ang binary commission?',
  'Unsa ang Product Binary?',
]

const CEB_RELATED_SUGGESTIONS: Record<string, string[]> = {
  wallet: ['Pila akong total earned?', 'Pila na akong total withdrawn?', 'Naa ba koy pending payout?', 'Unsaon nako pag-request og payout?'],
  payout: ['Naa ba koy pending payout?', 'Unsa ang payout requirements?', 'Pila akong wallet balance?', 'Unsaon pag-update sa payment method?'],
  orders: ['Pila akong pending orders?', 'Pila na ang delivered orders?', 'Asa makita ang akong order history?', 'Unsa inyong available perfumes?'],
  products: ['Pila ang reseller price?', 'Unsa inyong available perfumes?', 'Unsa ang SRP ug reseller price?', 'Asa ko maka-order og products?'],
  rank: ['Unsa akong current rank?', 'Pila akong total points?', 'Unsaon pag-rank up?', 'Unsa ang requirements sa next rank?'],
  points: ['Pila akong total points?', 'Unsa akong current rank?', 'Asa makita ang Rank Advancement?', 'Giunsa pag-compute ang points?'],
  'network-stats': ['Pila akong left ug right network?', 'Pila tanan akong downlines?', 'Asa makita ang Binary Tree?', 'Unsa kalainan sa sponsor ug placement?'],
  network: ['Pila akong left ug right network?', 'Asa makita ang akong affiliates?', 'Unsa kalainan sa sponsor ug placement?', 'Giunsa pag-work ang binary network?'],
  security: ['Unsaon pag-register niini nga device?', 'Unsa kalainan sa passkey ug Security PIN?', 'Unsaon pag-change sa Security PIN?', 'Unsaon pag-recover sa account?'],
  support: ['Pila akong active support tickets?', 'Asa makita ang ticket status?', 'Unsaon paghimo og support ticket?', 'Unsaon pag-reply sa support ticket?'],
  package: ['Unsa akong current package?', 'Unsa ang benefits sa akong package?', 'Unsaon pag-upgrade sa package?', 'Unsa ang package daily caps?'],
  commission: ['Pila akong total earned?', 'Unsa ang direct referral?', 'Giunsa pag-work ang binary commission?', 'Unsa ang Product Binary?'],
  'direct-referral': ['Unsa ang direct referral?', 'Kanus-a mahimong flashout ang referral?', 'Pila akong total earned?', 'Unsa ang package referral value?'],
  binary: ['Giunsa pag-work ang binary commission?', 'Unsa ang left ug right carryover?', 'Kanus-a mahimong flashout ang binary?', 'Pila akong left ug right network?'],
  'product-binary': ['Unsa ang Product Binary?', 'Pila ang Product Binary pair value?', 'Unsa ang PU?', 'Giunsa pag-apekto sa rank ang pair value?'],
}

const EN_GENERAL_SUGGESTIONS = [
  'What is my wallet balance?', 'What are my rank and points?', 'Where are my orders?',
  'Do I have a pending payout?', 'How many members are on my left and right legs?',
  'What is my current package?', 'What perfumes are available?', 'How many active support tickets do I have?',
  'How do I secure my account?', 'How does direct referral work?', 'How does binary commission work?', 'What is Product Binary?',
]

const EN_RELATED_SUGGESTIONS: Record<string, string[]> = {
  wallet: ['What is my total earned?', 'What is my total withdrawn?', 'Do I have a pending payout?', 'How do I request a payout?'],
  payout: ['Do I have a pending payout?', 'What are the payout requirements?', 'What is my wallet balance?', 'How do I update my payment method?'],
  orders: ['How many orders are pending?', 'How many orders were delivered?', 'Where is my order history?', 'What perfumes are available?'],
  products: ['What is the reseller price?', 'What perfumes are available?', 'What is the difference between SRP and reseller price?', 'Where can I order products?'],
  rank: ['What is my current rank?', 'How many points do I have?', 'How do I rank up?', 'What is required for the next rank?'],
  points: ['How many points do I have?', 'What is my current rank?', 'Where is Rank Advancement?', 'How are points calculated?'],
  'network-stats': ['How many members are on my left and right legs?', 'How many downlines do I have?', 'Where is my Binary Tree?', 'What is the difference between sponsor and placement?'],
  security: ['How do I register this device?', 'What is the difference between a passkey and Security PIN?', 'How do I change my Security PIN?', 'How do I recover my account?'],
  support: ['How many active support tickets do I have?', 'Where can I see ticket status?', 'How do I create a support ticket?', 'How do I reply to a ticket?'],
  commission: ['What is my total earned?', 'How does direct referral work?', 'How does binary commission work?', 'What is Product Binary?'],
}

const TL_GENERAL_SUGGESTIONS = [
  'Magkano ang wallet balance ko?', 'Ano ang rank at points ko?', 'Nasaan ang orders ko?',
  'May pending payout ba ako?', 'Ilan ang members sa left at right legs ko?', 'Ano ang current package ko?',
  'Anong perfumes ang available?', 'Ilan ang active support tickets ko?',
  'Paano ko ise-secure ang account ko?', 'Paano gumagana ang direct referral?', 'Paano gumagana ang binary commission?', 'Ano ang Product Binary?',
]

const TL_RELATED_SUGGESTIONS: Record<string, string[]> = {
  wallet: ['Magkano ang total earned ko?', 'Magkano ang total withdrawn ko?', 'May pending payout ba ako?', 'Paano mag-request ng payout?'],
  payout: ['May pending payout ba ako?', 'Ano ang payout requirements?', 'Magkano ang wallet balance ko?', 'Paano i-update ang payment method?'],
  orders: ['Ilan ang pending orders ko?', 'Ilan ang delivered orders ko?', 'Nasaan ang order history ko?', 'Anong perfumes ang available?'],
  products: ['Magkano ang reseller price?', 'Anong perfumes ang available?', 'Ano ang SRP at reseller price?', 'Saan ako makaka-order?'],
  rank: ['Ano ang current rank ko?', 'Ilan ang points ko?', 'Paano mag-rank up?', 'Ano ang next rank requirements?'],
  security: ['Paano i-register ang device na ito?', 'Ano ang passkey at Security PIN?', 'Paano palitan ang Security PIN?', 'Paano i-recover ang account?'],
  support: ['Ilan ang active support tickets ko?', 'Nasaan ang ticket status?', 'Paano gumawa ng support ticket?', 'Paano mag-reply sa ticket?'],
}

function seededShuffle(values: string[], seed: string) {
  let state = 2166136261
  for (const character of seed) {
    state ^= character.charCodeAt(0)
    state = Math.imul(state, 16777619)
  }
  const copy = [...values]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = Math.imul(state ^ (state >>> 15), 2246822519)
    const target = Math.abs(state) % (index + 1)
    ;[copy[index], copy[target]] = [copy[target], copy[index]]
  }
  return copy
}

export function getHiroSuggestions(messages: SuggestionMessage[], conversationId = '', accountQuestions: string[] = [], accountContext = ''): string[] {
  const latestHiro = [...messages].reverse().find((message) => message.role === 'hiro' && message.intent)
  const latestUser = [...messages].reverse().find((message) => message.role === 'user')
  const intent = latestHiro?.intent || ''
  let language: HiroLanguage = 'en'
  for (const message of messages) if (message.role === 'user') language = detectHiroLanguage(message.text, language)
  const general = language === 'tl' ? TL_GENERAL_SUGGESTIONS : language === 'ceb' ? CEB_GENERAL_SUGGESTIONS : EN_GENERAL_SUGGESTIONS
  const relatedPool = language === 'tl' ? TL_RELATED_SUGGESTIONS : language === 'ceb' ? CEB_RELATED_SUGGESTIONS : EN_RELATED_SUGGESTIONS
  const related = relatedPool[intent] || []
  const day = new Date().toISOString().slice(0, 10)
  const seed = `${day}:${conversationId}:${messages.length}:${intent}:${latestUser?.text || ''}:${accountContext}`
  const accountSelection = seededShuffle([...new Set(accountQuestions.filter(Boolean))], `${seed}:account`).slice(0, 2)
  const relatedSelection = seededShuffle(related, `${seed}:related`).slice(0, related.length ? 2 : 0)
    .filter((suggestion) => !accountSelection.includes(suggestion))
    .slice(0, Math.max(0, 4 - accountSelection.length))
  const discovery = seededShuffle(
    general.filter((suggestion) => !relatedSelection.includes(suggestion) && !accountSelection.includes(suggestion)),
    `${seed}:discovery`,
  ).slice(0, 4 - accountSelection.length - relatedSelection.length)
  return seededShuffle([...accountSelection, ...relatedSelection, ...discovery], `${seed}:final`).slice(0, 4)
}
