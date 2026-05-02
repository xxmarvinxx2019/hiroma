'use client'

const distributorLevels = [
  {
    icon: '🗺️',
    title: 'Regional distributor',
    desc: 'Cover an entire region. Supply provincial distributors below you. Be the backbone of Hiroma\'s supply chain in your area.',
    perks: [
      'Largest coverage area',
      'Supply chain priority',
      'Direct admin support',
    ],
  },
  {
    icon: '🏛️',
    title: 'Provincial distributor',
    desc: 'Manage distribution across your province. Order from your regional distributor and supply city distributors below you.',
    perks: [
      'Province-wide coverage',
      'Manage city distributors',
      'Access to full catalog',
    ],
  },
  {
    icon: '🏙️',
    title: 'City distributor',
    desc: 'The front line of Hiroma. Register resellers in your city, manage PINs and packages, and grow the local network.',
    perks: [
      'Register resellers',
      'Manage PINs & packages',
      'Direct reseller support',
    ],
  },
]

const howItWorks = [
  {
    number: '1',
    title: 'Submit your inquiry',
    desc: 'Fill out the contact form below expressing your interest in becoming a Hiroma distributor.',
  },
  {
    number: '2',
    title: 'Sign the contract',
    desc: 'Meet with the Hiroma team, go through the agreement, and sign your distribution contract.',
  },
  {
    number: '3',
    title: 'Get registered',
    desc: 'Admin registers you in the Hiroma system and assigns your coverage area.',
  },
  {
    number: '4',
    title: 'Start distributing',
    desc: 'Access the distribution system, manage your inventory, and grow your network.',
  },
]

const supplyChain = [
  { label: 'Admin', sub: 'Hiroma HQ', color: 'bg-[#0D1B3E] text-white' },
  { label: 'Regional', sub: 'Region-wide', color: 'bg-[#1A2F5E] text-white' },
  { label: 'Provincial', sub: 'Province-wide', color: 'bg-[#1A2F5E] text-white' },
  { label: 'City', sub: 'City-wide', color: 'bg-[#1A2F5E] text-white' },
  { label: 'Reseller', sub: 'End point', color: 'bg-[#C9A84C] text-[#0D1B3E]' },
]

export default function Distributor() {
  return (
    <section id="distributor" className="bg-[#F0F2F8] py-16 px-6">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <p className="text-[#C9A84C] text-xs font-semibold tracking-[0.2em] uppercase text-center mb-2">
          Distribution network
        </p>
        <h2 className="text-2xl font-semibold text-[#0D1B3E] text-center mb-2">
          Become a Hiroma distributor
        </h2>
        <p className="text-sm text-gray-400 text-center leading-relaxed max-w-lg mx-auto mb-12">
          We are looking for dedicated partners to grow the Hiroma brand across
          the Philippines. Three levels of distribution are available — each
          with its own role and responsibilities.
        </p>

        {/* Distributor Level Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-14">
          {distributorLevels.map((level) => (
            <div
              key={level.title}
              className="bg-white rounded-xl border border-[#0D1B3E]/10 p-6 hover:shadow-md transition-shadow duration-200"
            >
              {/* Icon */}
              <div className="w-12 h-12 bg-[#0D1B3E] rounded-xl flex items-center justify-center text-2xl mb-4">
                {level.icon}
              </div>

              {/* Title & Desc */}
              <h3 className="text-[#0D1B3E] font-semibold text-sm mb-2">
                {level.title}
              </h3>
              <p className="text-gray-400 text-xs leading-relaxed mb-4">
                {level.desc}
              </p>

              {/* Perks */}
              <div className="flex flex-col gap-2">
                {level.perks.map((perk) => (
                  <div key={perk} className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#C9A84C] flex-shrink-0" />
                    <span className="text-xs text-[#0D1B3E]">{perk}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="border-t border-[#0D1B3E]/10 mb-12" />

        {/* Supply Chain Visual */}
        <p className="text-[#C9A84C] text-xs font-semibold tracking-[0.2em] uppercase text-center mb-2">
          Supply chain
        </p>
        <h2 className="text-2xl font-semibold text-[#0D1B3E] text-center mb-8">
          How products flow
        </h2>

        <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
          {supplyChain.map((node, index) => (
            <div key={node.label} className="flex items-center gap-2">
              <div className={`${node.color} rounded-xl px-4 py-3 text-center min-w-[80px]`}>
                <div className="font-semibold text-sm">{node.label}</div>
                <div className="text-xs opacity-60 mt-0.5">{node.sub}</div>
              </div>
              {index < supplyChain.length - 1 && (
                <span className="text-[#C9A84C] text-lg font-light">→</span>
              )}
            </div>
          ))}
        </div>

        <p className="text-xs text-gray-400 text-center mb-4">
          PINs flow directly: <span className="text-[#0D1B3E] font-medium">Admin → City distributor only</span>
        </p>
        <p className="text-xs text-gray-400 text-center mb-12">
          Low stock? System auto-detects and suggests an alternative same-level distributor as supplier.
        </p>

        {/* Divider */}
        <div className="border-t border-[#0D1B3E]/10 mb-12" />

        {/* How to become one */}
        <p className="text-[#C9A84C] text-xs font-semibold tracking-[0.2em] uppercase text-center mb-2">
          How to apply
        </p>
        <h2 className="text-2xl font-semibold text-[#0D1B3E] text-center mb-8">
          Become a distributor in 4 steps
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          {howItWorks.map((step) => (
            <div
              key={step.number}
              className="bg-white rounded-xl border border-[#0D1B3E]/10 p-5 text-center"
            >
              <div className="w-9 h-9 rounded-full bg-[#0D1B3E] text-[#C9A84C] font-bold text-sm flex items-center justify-center mx-auto mb-4">
                {step.number}
              </div>
              <h4 className="text-[#0D1B3E] font-semibold text-sm mb-2">
                {step.title}
              </h4>
              <p className="text-gray-400 text-xs leading-relaxed">
                {step.desc}
              </p>
            </div>
          ))}
        </div>

        {/* Bottom CTA Banner */}
        <div className="bg-[#0D1B3E] rounded-xl p-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="text-white font-semibold text-base mb-1">
              Interested in becoming a distributor?
            </h3>
            <p className="text-white/50 text-sm">
              Sign a contract with Hiroma and get registered by our admin team.
            </p>
          </div>
          <a
            href="#contact"
            className="bg-[#C9A84C] text-[#0D1B3E] font-semibold text-sm rounded-lg px-6 py-3 hover:bg-[#E8C96A] transition-all duration-150 whitespace-nowrap"
          >
            Send an inquiry
          </a>
        </div>

      </div>
    </section>
  )
}