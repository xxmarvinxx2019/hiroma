'use client'

import { useState, useEffect } from 'react'

interface Product {
  id:          string
  name:        string
  description: string | null
  price:       number   // SRP
  type:        string
  image_url:   string | null
}

const FALLBACK_EMOJI: Record<string, string> = {
  physical: '🧴',
  digital:  '📱',
}

const features = [
  { icon: '💧', title: 'Oil-based formula',    desc: 'No alcohol — pure oil that lasts longer and is gentler on skin.' },
  { icon: '⏱️', title: 'Long lasting',         desc: 'Up to 12 hours of rich, consistent fragrance throughout the day.' },
  { icon: '🌿', title: 'Skin friendly',         desc: 'Crafted with safe, premium-grade ingredients for all skin types.' },
  { icon: '📦', title: 'Premium packaging',     desc: 'Elegant bottles designed to stand out on any shelf or collection.' },
]

export default function Products() {
  const [products, setProducts]   = useState<Product[]>([])
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    fetch('/api/products/featured')
      .then((r) => r.json())
      .then((d) => setProducts(d.products || []))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <section id="products" className="bg-white py-20 px-6">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <p className="text-[#C9A84C] text-[10px] font-bold tracking-[0.35em] uppercase text-center mb-3 flex items-center justify-center gap-3">
          <span className="w-8 h-px bg-[#C9A84C]/40" />
          Our collection
          <span className="w-8 h-px bg-[#C9A84C]/40" />
        </p>
        <h2 className="text-3xl font-semibold text-[#0D1B3E] text-center mb-3">
          Premium fragrances
        </h2>
        <p className="text-sm text-gray-400 text-center leading-relaxed max-w-lg mx-auto mb-12">
          Crafted with the finest oil-rich ingredients for a long-lasting scent experience unlike any other. Each Hiroma fragrance tells a story.
        </p>

        {/* Product Cards */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-14">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl border border-[#0D1B3E]/10 overflow-hidden animate-pulse">
                <div className="h-48 bg-[#F0F2F8]" />
                <div className="p-5 space-y-3">
                  <div className="h-3 bg-[#F0F2F8] rounded w-1/3" />
                  <div className="h-4 bg-[#F0F2F8] rounded w-2/3" />
                  <div className="h-3 bg-[#F0F2F8] rounded w-full" />
                  <div className="h-3 bg-[#F0F2F8] rounded w-4/5" />
                </div>
              </div>
            ))}
          </div>
        ) : products.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-14">
            {products.map((product, i) => (
              <div key={product.id}
                className="bg-white rounded-2xl border border-[#0D1B3E]/10 overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group">

                {/* Image area */}
                <div className="relative h-48 overflow-hidden"
                  style={{ background: i === 0 ? '#0D1B3E' : i === 1 ? '#fef9ee' : '#f4f6fb' }}>
                  {product.image_url ? (
                    <img src={product.image_url} alt={product.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-6xl opacity-80">{FALLBACK_EMOJI[product.type] || '🧴'}</span>
                    </div>
                  )}
                  {/* Badge */}
                  {i === 0 && (
                    <span className="absolute top-3 left-3 text-[10px] font-semibold bg-[#C9A84C] text-[#0D1B3E] px-2.5 py-1 rounded-full">
                      Bestseller
                    </span>
                  )}
                  {i === 1 && (
                    <span className="absolute top-3 left-3 text-[10px] font-semibold bg-[#e8f7ef] text-[#1a7a4a] px-2.5 py-1 rounded-full">
                      New arrival
                    </span>
                  )}
                  {i === 2 && (
                    <span className="absolute top-3 left-3 text-[10px] font-semibold bg-[#eef0f8] text-[#0D1B3E] px-2.5 py-1 rounded-full">
                      Premium
                    </span>
                  )}
                </div>

                {/* Info */}
                <div className="p-5">
                  <h3 className="text-[#0D1B3E] font-semibold text-base mb-2">{product.name}</h3>
                  <p className="text-gray-400 text-xs leading-relaxed mb-4 line-clamp-2">
                    {product.description || 'Premium oil-based fragrance with a rich, lasting scent.'}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-[#C9A84C] font-bold text-lg">
                      ₱{Number(product.price).toLocaleString()}
                    </span>
                    <span className="text-gray-400 text-xs bg-[#F0F2F8] px-3 py-1 rounded-full capitalize">
                      {product.type}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          // Fallback placeholder if no products yet
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-14">
            {[
              { name: 'Hiroma Poseidon', desc: 'Deep marine oud with smoky amber. 12 hours of rich lasting scent.', price: '₱850', bg: '#0D1B3E', emoji: '🌊', badge: 'Bestseller', badgeColor: 'bg-[#C9A84C] text-[#0D1B3E]' },
              { name: 'Hiroma Cleopatra', desc: 'Fresh floral rose with a subtle musk finish. Light and elegant for everyday wear.', price: '₱650', bg: '#fef9ee', emoji: '🌹', badge: 'New arrival', badgeColor: 'bg-[#e8f7ef] text-[#1a7a4a]' },
              { name: 'Hiroma Noir', desc: 'Bold, mysterious noir blend with citrus top notes. Made for those who command attention.', price: '₱950', bg: '#f4f6fb', emoji: '✨', badge: 'Premium', badgeColor: 'bg-[#eef0f8] text-[#0D1B3E]' },
            ].map((p, i) => (
              <div key={i} className="bg-white rounded-2xl border border-[#0D1B3E]/10 overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                <div className="relative h-48 flex items-center justify-center" style={{ background: p.bg }}>
                  <span className="text-6xl">{p.emoji}</span>
                  <span className={`absolute top-3 left-3 text-[10px] font-semibold px-2.5 py-1 rounded-full ${p.badgeColor}`}>{p.badge}</span>
                </div>
                <div className="p-5">
                  <h3 className="text-[#0D1B3E] font-semibold text-base mb-2">{p.name}</h3>
                  <p className="text-gray-400 text-xs leading-relaxed mb-4">{p.desc}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[#C9A84C] font-bold text-lg">{p.price}</span>
                    <span className="text-gray-400 text-xs bg-[#F0F2F8] px-3 py-1 rounded-full">50ml</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-[#0D1B3E]/8 mb-14" />

        {/* Features */}
        <p className="text-[#C9A84C] text-[10px] font-bold tracking-[0.35em] uppercase text-center mb-3 flex items-center justify-center gap-3">
          <span className="w-8 h-px bg-[#C9A84C]/40" />
          Why Hiroma
          <span className="w-8 h-px bg-[#C9A84C]/40" />
        </p>
        <h2 className="text-2xl font-semibold text-[#0D1B3E] text-center mb-10">
          What makes us different
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-5">
          {features.map((feature) => (
            <div key={feature.title}
              className="text-center p-5 rounded-2xl border border-[#0D1B3E]/8 hover:border-[#C9A84C]/40 hover:shadow-md transition-all duration-200">
              <div className="text-4xl mb-4">{feature.icon}</div>
              <h4 className="text-[#0D1B3E] font-semibold text-sm mb-2">{feature.title}</h4>
              <p className="text-gray-400 text-xs leading-relaxed">{feature.desc}</p>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-14 bg-[#0D1B3E] rounded-2xl p-8 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(ellipse 40% 80% at 80% 50%, rgba(201,168,76,0.08) 0%, transparent 70%)' }} />
          <div className="relative">
            <h3 className="text-white font-semibold text-xl mb-2">Want to sell Hiroma products?</h3>
            <p className="text-white/50 text-sm">Become a reseller and earn commissions on every sale.</p>
          </div>
          <a href="#contact"
            className="relative bg-[#C9A84C] text-[#0D1B3E] font-bold text-sm rounded-xl px-8 py-3.5 hover:bg-[#E8C96A] transition-all duration-150 whitespace-nowrap active:scale-95">
            Get started today
          </a>
        </div>

      </div>
    </section>
  )
}