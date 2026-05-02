'use client'

const steps = [
  {
    number: '1',
    title: 'Get your starter kit',
    desc: 'Visit your city distributor, choose a package, and get your PIN to activate your reseller account.',
  },
  {
    number: '2',
    title: 'Build your network',
    desc: 'Share your referral username. Every person you refer joins your binary tree on your left or right leg.',
  },
  {
    number: '3',
    title: 'Earn commissions',
    desc: 'Earn direct referral bonuses, binary pairing bonuses, multi-level commissions and sponsor points.',
  },
  {
    number: '4',
    title: 'Withdraw earnings',
    desc: 'All earnings go to your Hiroma wallet. Request a payout anytime via GCash or bank transfer.',
  },
]

const incomeStreams = [
  {
    icon: '👥',
    title: 'Direct referral bonus',
    desc: 'Earn every time someone registers using your referral username and PIN. Amount is based on your package tier.',
    color: 'border-l-[#C9A84C]',
  },
  {
    icon: '⚖️',
    title: 'Binary pairing bonus',
    desc: 'Earn when your left and right legs match a pair. Bonus is based on your package tier with cascade benefits for higher-tier downlines.',
    color: 'border-l-[#C9A84C]',
  },
  {
    icon: '🌐',
    title: 'Multi-level bonus',
    desc: 'Earn from your downline\'s activity across multiple levels — the deeper your network grows, the more you earn.',
    color: 'border-l-[#C9A84C]',
  },
  {
    icon: '⭐',
    title: 'Sponsor pairing points',
    desc: 'Earn points when both your personally referred left & right members each purchase 2 bottles. Points convert to PHP. Up to 12 pairs per day.',
    color: 'border-l-[#C9A84C]',
  },
]

const rules = [
  {
    label: 'Daily referral cap',
    value: '10 referrals/day',
    note: 'Overflow goes to Hiroma',
  },
  {
    label: 'Daily pairs cap',
    value: '12 pairs/day',
    note: 'Overflow goes to Hiroma',
  },
  {
    label: 'Name cap',
    value: '7 accounts max',
    note: 'Per name across network',
  },
  {
    label: 'Binary structure',
    value: 'Left & right legs',
    note: 'Referrer chooses placement',
  },
]

export default function Opportunity() {
  return (
    <section id="opportunity" className="bg-[#0D1B3E] py-16 px-6">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <p className="text-[#C9A84C] text-xs font-semibold tracking-[0.2em] uppercase text-center mb-2">
          The opportunity
        </p>
        <h2 className="text-2xl font-semibold text-white text-center mb-2">
          Earn while you share
        </h2>
        <p className="text-sm text-white/50 text-center leading-relaxed max-w-lg mx-auto mb-12">
          Join Hiroma's exclusive reseller network and earn through multiple
          income streams — all from sharing premium fragrances you love.
        </p>

        {/* Steps */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-14">
          {steps.map((step, index) => (
            <div
              key={step.number}
              className="bg-white/5 border border-white/10 rounded-xl p-5 text-center relative"
            >
              {/* Connector line for desktop */}
              {index < steps.length - 1 && (
                <div className="hidden md:block absolute top-8 -right-2 w-4 h-0.5 bg-[#C9A84C]/30 z-10" />
              )}
              <div className="w-9 h-9 rounded-full bg-[#C9A84C] text-[#0D1B3E] font-bold text-sm flex items-center justify-center mx-auto mb-4">
                {step.number}
              </div>
              <h3 className="text-white font-semibold text-sm mb-2">
                {step.title}
              </h3>
              <p className="text-white/50 text-xs leading-relaxed">
                {step.desc}
              </p>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="border-t border-white/10 mb-12" />

        {/* Income Streams */}
        <p className="text-[#C9A84C] text-xs font-semibold tracking-[0.2em] uppercase text-center mb-2">
          Income streams
        </p>
        <h2 className="text-2xl font-semibold text-white text-center mb-8">
          4 ways to earn with Hiroma
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-14">
          {incomeStreams.map((stream) => (
            <div
              key={stream.title}
              className={`bg-white rounded-xl p-4 border-l-4 ${stream.color}`}
            >
              <div className="text-2xl mb-3">{stream.icon}</div>
              <h4 className="text-[#0D1B3E] font-semibold text-sm mb-2">
                {stream.title}
              </h4>
              <p className="text-gray-400 text-xs leading-relaxed">
                {stream.desc}
              </p>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="border-t border-white/10 mb-12" />

        {/* Rules Summary */}
        <p className="text-[#C9A84C] text-xs font-semibold tracking-[0.2em] uppercase text-center mb-2">
          System rules
        </p>
        <h2 className="text-2xl font-semibold text-white text-center mb-8">
          Fair & transparent structure
        </h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          {rules.map((rule) => (
            <div
              key={rule.label}
              className="bg-white/5 border border-white/10 rounded-xl p-4 text-center"
            >
              <p className="text-white/40 text-xs mb-2 uppercase tracking-wide">
                {rule.label}
              </p>
              <p className="text-[#C9A84C] text-base font-semibold mb-1">
                {rule.value}
              </p>
              <p className="text-white/40 text-xs">{rule.note}</p>
            </div>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="bg-[#C9A84C]/10 border border-[#C9A84C]/30 rounded-xl p-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="text-white font-semibold text-base mb-1">
              Ready to start earning?
            </h3>
            <p className="text-white/50 text-sm">
              Get your starter package from your nearest city distributor today.
            </p>
          </div>
          <a
            href="#contact"
            className="bg-[#C9A84C] text-[#0D1B3E] font-semibold text-sm rounded-lg px-6 py-3 hover:bg-[#E8C96A] transition-all duration-150 whitespace-nowrap"
          >
            Join Hiroma now
          </a>
        </div>

      </div>
    </section>
  )
}