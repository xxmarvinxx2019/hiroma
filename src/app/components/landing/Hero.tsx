'use client'

import { useEffect, useRef } from 'react'

export default function Hero() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width  = canvas.offsetWidth
    canvas.height = canvas.offsetHeight

    // Floating particles — like perfume mist
    const particles: { x: number; y: number; r: number; vy: number; vx: number; o: number }[] = []
    for (let i = 0; i < 60; i++) {
      particles.push({
        x:  Math.random() * canvas.width,
        y:  Math.random() * canvas.height,
        r:  Math.random() * 2 + 0.5,
        vy: -(Math.random() * 0.4 + 0.1),
        vx: (Math.random() - 0.5) * 0.2,
        o:  Math.random() * 0.4 + 0.1,
      })
    }

    let animId: number
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const p of particles) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(201,168,76,${p.o})`
        ctx.fill()
        p.y += p.vy
        p.x += p.vx
        if (p.y < -5) { p.y = canvas.height + 5; p.x = Math.random() * canvas.width }
      }
      animId = requestAnimationFrame(animate)
    }
    animate()
    return () => cancelAnimationFrame(animId)
  }, [])

  return (
    <section className="relative bg-[#0D1B3E] overflow-hidden">

      {/* Particle canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

      {/* Radial glow */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 60% 50% at 70% 50%, rgba(201,168,76,0.08) 0%, transparent 70%)' }} />

      <div className="relative max-w-7xl mx-auto px-6 py-12 md:py-16 grid grid-cols-1 md:grid-cols-2 gap-12 items-center w-full">

        {/* ── Left — Brand copy ── */}
        <div>
          <p className="text-[#C9A84C] text-[10px] font-bold tracking-[0.35em] uppercase mb-5 flex items-center gap-2">
            <span className="w-6 h-px bg-[#C9A84C]" />
            Oil-rich fragrance · Philippines
          </p>

          <h1 className="text-white font-semibold leading-[1.08] mb-6" style={{ fontSize: 'clamp(2.4rem, 5vw, 4rem)' }}>
            Wear a scent<br />
            they will{' '}
            <span className="relative inline-block">
              <span className="text-[#C9A84C]">never forget.</span>
              <span className="absolute -bottom-1 left-0 w-full h-px bg-[#C9A84C]/40" />
            </span>
          </h1>

          <p className="text-white/55 text-base leading-relaxed mb-10 max-w-md">
            Hiroma crafts premium oil-based fragrances that last all day — no alcohol,
            pure scent. Each bottle carries a rich, lasting story made for the bold and the refined.
          </p>

          {/* Scent notes */}
          <div className="flex flex-wrap gap-2 mb-10">
            {['🌙 Oud & Amber', '🌹 Rose & Musk', '🌿 Sandalwood', '✨ Noir Citrus', '🍂 Vanilla Spice'].map((note) => (
              <span key={note} className="text-xs text-[#C9A84C]/80 border border-[#C9A84C]/25 px-3 py-1.5 rounded-full bg-[#C9A84C]/5">
                {note}
              </span>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            <a href="#products"
              className="bg-[#C9A84C] text-[#0D1B3E] font-bold text-sm rounded-xl px-7 py-3.5 hover:bg-[#E8C96A] transition-all duration-150 active:scale-95">
              Explore collection
            </a>
            <a href="#contact"
              className="text-white font-medium text-sm rounded-xl px-7 py-3.5 border border-white/20 hover:bg-white/8 transition-all duration-150">
              Become a reseller →
            </a>
          </div>
        </div>

        {/* ── Right — Perfume visual ── */}
        <div className="flex flex-col gap-4">

          {/* Hero product showcase — Hiroma Clio */}
          <div className="relative bg-gradient-to-br from-[#3a1a0a] via-[#1a0d05] to-[#0D1B3E] border border-[#C9A84C]/30 rounded-2xl overflow-hidden flex items-center gap-0">
            <div className="absolute inset-0 pointer-events-none"
              style={{ background: 'radial-gradient(ellipse 60% 80% at 30% 50%, rgba(201,168,76,0.12) 0%, transparent 70%)' }} />

            {/* Product image */}
            <div className="relative w-44 h-56 flex-shrink-0 flex items-end justify-center px-4 pb-0">
              <img
                src="/images/perfume-clio.png"
                alt="Hiroma Clio Eau de Parfum"
                className="h-full w-auto object-contain drop-shadow-2xl"
                style={{ filter: 'drop-shadow(0 8px 32px rgba(201,168,76,0.3))' }}
              />
            </div>

            {/* Product info */}
            <div className="relative flex-1 p-6">
              <p className="text-[#C9A84C] text-[10px] tracking-widest uppercase mb-2">Eau de Parfum · Women</p>
              <h3 className="text-white font-semibold text-2xl mb-1 tracking-wide">CLIO</h3>
              <p className="text-white/40 text-xs mb-4">by HIROMA · Made in the Philippines</p>
              <p className="text-white/60 text-xs leading-relaxed mb-4">
                A rich floral oriental with warm amber and sensual musk. Oil-rich formula for all-day wear.
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-[#C9A84C] font-bold text-xl">₱220</span>
                <span className="text-white/30 text-xs border border-white/10 px-2 py-0.5 rounded-full">200ml · Oil-based</span>
              </div>
              <div className="mt-3 flex gap-1.5">
                {['🌸 Floral', '🍂 Amber', '🌿 Musk'].map((n) => (
                  <span key={n} className="text-[10px] text-[#C9A84C]/70 border border-[#C9A84C]/20 px-2 py-0.5 rounded-full bg-[#C9A84C]/5">{n}</span>
                ))}
              </div>
            </div>
          </div>

          {/* 3 feature cards */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: '💧', label: 'Oil-based', sub: 'No alcohol' },
              { icon: '⏱️', label: '12hr wear', sub: 'Long lasting' },
              { icon: '🌿', label: 'Skin safe', sub: 'All skin types' },
            ].map((f) => (
              <div key={f.label} className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                <span className="text-2xl">{f.icon}</span>
                <p className="text-white text-xs font-semibold mt-1">{f.label}</p>
                <p className="text-white/40 text-[10px] mt-0.5">{f.sub}</p>
              </div>
            ))}
          </div>

          {/* Social proof */}
          <div className="bg-white/5 border border-white/10 rounded-xl px-5 py-4 flex items-center justify-between">
            <div className="flex -space-x-2">
              {['A', 'M', 'R', 'J', 'L'].map((l, i) => (
                <div key={i} className="w-8 h-8 rounded-full bg-[#C9A84C]/20 border-2 border-[#0D1B3E] flex items-center justify-center">
                  <span className="text-[#C9A84C] text-xs font-bold">{l}</span>
                </div>
              ))}
            </div>
            <div className="text-right">
              <p className="text-white text-sm font-semibold">2,800+ customers</p>
              <p className="text-[#C9A84C] text-xs">love Hiroma fragrances</p>
            </div>
          </div>

        </div>
      </div>


    </section>
  )
}