'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <nav className="sticky top-0 z-50 bg-[#0D1B3E] border-b border-white/5">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-3">
          <div className="w-10 h-10 relative flex-shrink-0">
            <Image
              src="/hiroma-logo.jpg"
              alt="Hiroma logo"
              fill
              className="object-contain rounded-lg"
              priority
            />
          </div>
          <span className="text-white font-medium text-base tracking-[0.25em]">
            HIROMA
          </span>
        </Link>

        {/* Desktop Nav Links */}
        <div className="hidden md:flex items-center gap-8">
          <a href="#products" className="text-white/60 text-sm hover:text-white transition-colors duration-150">
            Products
          </a>
          <a href="#opportunity" className="text-white/60 text-sm hover:text-white transition-colors duration-150">
            Opportunity
          </a>
          <a href="#distributor" className="text-white/60 text-sm hover:text-white transition-colors duration-150">
            Distributors
          </a>
          <a href="#contact" className="text-white/60 text-sm hover:text-white transition-colors duration-150">
            Contact
          </a>
        </div>

        {/* Desktop CTA Buttons */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/login"
            className="text-[#C9A84C] text-sm font-medium border border-[#C9A84C] rounded-lg px-4 py-2 hover:bg-[#C9A84C] hover:text-[#0D1B3E] transition-all duration-150"
          >
            Sign in
          </Link>
          <a
            href="#contact"
            className="bg-[#C9A84C] text-[#0D1B3E] text-sm font-semibold rounded-lg px-4 py-2 hover:bg-[#E8C96A] transition-all duration-150"
          >
            Join now
          </a>
        </div>

        {/* Mobile Menu Button */}
        <button
          className="md:hidden text-white/60 hover:text-white"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>

      </div>

      {/* Mobile Menu */}
      {menuOpen && (
        <div className="md:hidden bg-[#0D1B3E] border-t border-white/5 px-6 py-4 flex flex-col gap-4">
          <a
            href="#products"
            className="text-white/60 text-sm hover:text-white transition-colors"
            onClick={() => setMenuOpen(false)}
          >
            Products
          </a>
          <a
            href="#opportunity"
            className="text-white/60 text-sm hover:text-white transition-colors"
            onClick={() => setMenuOpen(false)}
          >
            Opportunity
          </a>
          <a
            href="#distributor"
            className="text-white/60 text-sm hover:text-white transition-colors"
            onClick={() => setMenuOpen(false)}
          >
            Distributors
          </a>
          <a
            href="#contact"
            className="text-white/60 text-sm hover:text-white transition-colors"
            onClick={() => setMenuOpen(false)}
          >
            Contact
          </a>
          <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
            <Link
              href="/login"
              className="text-[#C9A84C] text-sm font-medium border border-[#C9A84C] rounded-lg px-4 py-2 text-center hover:bg-[#C9A84C] hover:text-[#0D1B3E] transition-all duration-150"
            >
              Sign in
            </Link>
            <a
              href="#contact"
              className="bg-[#C9A84C] text-[#0D1B3E] text-sm font-semibold rounded-lg px-4 py-2 text-center hover:bg-[#E8C96A] transition-all duration-150"
              onClick={() => setMenuOpen(false)}
            >
              Join now
            </a>
          </div>
        </div>
      )}
    </nav>
  )
}