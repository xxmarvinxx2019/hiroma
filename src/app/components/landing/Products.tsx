'use client'

const products = [
  {
    id: 1,
    name: 'Hiroma Oud',
    description:
      'Deep, warm oud with notes of amber and sandalwood. Long-lasting oil-based formula.',
    price: '₱850',
    size: '50ml',
    badge: 'Bestseller',
    badgeColor: 'bg-[#fef6e4] text-[#9a6f1e]',
    bg: 'bg-[#0D1B3E]',
    emoji: '🌙',
    emojiColor: 'text-[#C9A84C]',
  },
  {
    id: 2,
    name: 'Hiroma Rose',
    description:
      'Fresh floral rose with a subtle musk finish. Light and elegant for everyday wear.',
    price: '₱650',
    size: '30ml',
    badge: 'New arrival',
    badgeColor: 'bg-[#e8f7ef] text-[#1a7a4a]',
    bg: 'bg-[#fef9ee]',
    emoji: '🌹',
    emojiColor: 'text-[#C9A84C]',
  },
  {
    id: 3,
    name: 'Hiroma Noir',
    description:
      'Bold, mysterious noir blend with citrus top notes. Made for those who command attention.',
    price: '₱950',
    size: '50ml',
    badge: 'Premium',
    badgeColor: 'bg-[#eef0f8] text-[#0D1B3E]',
    bg: 'bg-[#f4f6fb]',
    emoji: '✨',
    emojiColor: 'text-[#0D1B3E]',
  },
]

const features = [
  {
    icon: '💧',
    title: 'Oil-based formula',
    desc: 'No alcohol — pure oil that lasts longer and is gentler on skin.',
  },
  {
    icon: '⏱️',
    title: 'Long lasting',
    desc: 'Up to 12 hours of rich, consistent fragrance throughout the day.',
  },
  {
    icon: '🌿',
    title: 'Skin friendly',
    desc: 'Crafted with safe, premium-grade ingredients for all skin types.',
  },
  {
    icon: '📦',
    title: 'Premium packaging',
    desc: 'Elegant bottles designed to stand out on any shelf or collection.',
  },
]

export default function Products() {
  return (
    <section id="products" className="bg-white py-16 px-6">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <p className="text-[#C9A84C] text-xs font-semibold tracking-[0.2em] uppercase text-center mb-2">
          Our collection
        </p>
        <h2 className="text-2xl font-semibold text-[#0D1B3E] text-center mb-2">
          Premium fragrances
        </h2>
        <p className="text-sm text-gray-400 text-center leading-relaxed max-w-lg mx-auto mb-10">
          Crafted with the finest oil-rich ingredients for a long-lasting scent
          experience unlike any other. Each Hiroma fragrance tells a story.
        </p>

        {/* Product Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-14">
          {products.map((product) => (
            <div
              key={product.id}
              className="bg-white rounded-xl border border-[#0D1B3E]/10 overflow-hidden hover:shadow-lg transition-shadow duration-200"
            >
              {/* Product Image Area */}
              <div className={`${product.bg} h-36 flex items-center justify-center`}>
                <span className={`text-5xl ${product.emojiColor}`}>
                  {product.emoji}
                </span>
              </div>

              {/* Product Info */}
              <div className="p-4">
                <span className={`text-xs px-2 py-0.5 rounded-full ${product.badgeColor} mb-2 inline-block`}>
                  {product.badge}
                </span>
                <h3 className="text-[#0D1B3E] font-semibold text-sm mb-1">
                  {product.name}
                </h3>
                <p className="text-gray-400 text-xs leading-relaxed mb-3">
                  {product.description}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-[#C9A84C] font-semibold text-base">
                    {product.price}
                  </span>
                  <span className="text-gray-400 text-xs bg-[#F0F2F8] px-2 py-1 rounded-full">
                    {product.size}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="border-t border-[#0D1B3E]/8 mb-12" />

        {/* Features */}
        <p className="text-[#C9A84C] text-xs font-semibold tracking-[0.2em] uppercase text-center mb-2">
          Why Hiroma
        </p>
        <h2 className="text-2xl font-semibold text-[#0D1B3E] text-center mb-8">
          What makes us different
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="text-center p-4 rounded-xl border border-[#0D1B3E]/8 hover:border-[#C9A84C]/40 transition-colors duration-200"
            >
              <div className="text-3xl mb-3">{feature.icon}</div>
              <h4 className="text-[#0D1B3E] font-semibold text-sm mb-2">
                {feature.title}
              </h4>
              <p className="text-gray-400 text-xs leading-relaxed">
                {feature.desc}
              </p>
            </div>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="mt-12 bg-[#0D1B3E] rounded-xl p-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="text-white font-semibold text-base mb-1">
              Want to sell Hiroma products?
            </h3>
            <p className="text-white/50 text-sm">
              Become a reseller and earn commissions on every sale.
            </p>
          </div>
          <a
            href="#contact"
            className="bg-[#C9A84C] text-[#0D1B3E] font-semibold text-sm rounded-lg px-6 py-3 hover:bg-[#E8C96A] transition-all duration-150 whitespace-nowrap"
          >
            Get started today
          </a>
        </div>

      </div>
    </section>
  )
}