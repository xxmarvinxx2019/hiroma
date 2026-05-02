'use client'

export default function Hero() {
  return (
    <section className="bg-[#0D1B3E] px-6 py-16 md:py-24">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-12 items-center">

        {/* Left — Text Content */}
        <div>
          <p className="text-[#C9A84C] text-xs font-semibold tracking-[0.2em] uppercase mb-3">
            Long lasting oil rich fragrance
          </p>

          <h1 className="text-white text-4xl md:text-5xl font-semibold leading-tight mb-5">
            Premium scents.{' '}
            <br />
            Limitless{' '}
            <span className="text-[#C9A84C]">earnings.</span>
          </h1>

          <p className="text-white/60 text-sm leading-relaxed mb-8 max-w-md">
            Hiroma brings you world-class oil-rich fragrances while giving you
            the opportunity to build a business and earn through our exclusive
            reseller network across the Philippines.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-wrap gap-3 mb-10">
            <a
              href="#contact"
              className="bg-[#C9A84C] text-[#0D1B3E] font-semibold text-sm rounded-lg px-6 py-3 hover:bg-[#E8C96A] transition-all duration-150 active:scale-95"
            >
              Become a reseller
            </a>
            <a
              href="#products"
              className="bg-transparent text-white font-medium text-sm rounded-lg px-6 py-3 border border-white/30 hover:bg-white/10 transition-all duration-150"
            >
              Explore products
            </a>
          </div>

          {/* Stats */}
          <div className="flex flex-wrap gap-8 pt-6 border-t border-white/10">
            <div>
              <div className="text-[#C9A84C] text-2xl font-semibold">2,800+</div>
              <div className="text-white/50 text-xs mt-1">Active resellers</div>
            </div>
            <div>
              <div className="text-[#C9A84C] text-2xl font-semibold">38</div>
              <div className="text-white/50 text-xs mt-1">Distributors nationwide</div>
            </div>
            <div>
              <div className="text-[#C9A84C] text-2xl font-semibold">₱50M+</div>
              <div className="text-white/50 text-xs mt-1">Commissions paid</div>
            </div>
          </div>
        </div>

        {/* Right — Highlight Cards */}
        <div className="flex flex-col gap-4">

          {/* Top earner card */}
          <div className="bg-[#C9A84C]/10 border border-[#C9A84C]/40 rounded-xl p-4">
            <p className="text-white/50 text-xs tracking-widest uppercase mb-2">
              Top earner this month
            </p>
            <p className="text-white text-2xl font-semibold">₱48,200</p>
            <p className="text-[#C9A84C] text-xs mt-1">Gold tier reseller · Iloilo</p>
          </div>

          {/* New resellers card */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <p className="text-white/50 text-xs tracking-widest uppercase mb-2">
              New resellers today
            </p>
            <p className="text-white text-2xl font-semibold">124 joined</p>
            <p className="text-[#C9A84C] text-xs mt-1">Across all cities</p>
          </div>

          {/* Packages card */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <p className="text-white/50 text-xs tracking-widest uppercase mb-2">
              Available packages
            </p>
            <p className="text-white text-2xl font-semibold">Starting at ₱1,200</p>
            <p className="text-[#C9A84C] text-xs mt-1">
              Multiple tiers available
            </p>
          </div>

          {/* Income streams quick preview */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <p className="text-white/50 text-xs tracking-widest uppercase mb-3">
              Your income streams
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                'Direct referral bonus',
                'Binary pairing bonus',
                'Multi-level bonus',
                'Sponsor points',
              ].map((item) => (
                <span
                  key={item}
                  className="bg-[#C9A84C]/15 text-[#C9A84C] text-xs px-3 py-1 rounded-full border border-[#C9A84C]/30"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}