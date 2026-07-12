'use client'

import Image from 'next/image' // Added for the logo image

const footerLinks = {
  Company: [
    { label: 'About Hiroma', href: '#' },
    { label: 'Our products', href: '#products' },
    { label: 'The opportunity', href: '#opportunity' },
    { label: 'Distributors', href: '#distributor' },
    { label: 'Contact us', href: '#contact' },
  ],
  'For resellers': [
    { label: 'How to join', href: '#opportunity' },
    { label: 'Starter packages', href: '#opportunity' },
    { label: 'Income streams', href: '#opportunity' },
    { label: 'Binary tree explained', href: '#opportunity' },
    { label: 'Sign in', href: '/login' },
  ],
  'For distributors': [
    { label: 'Regional distributor', href: '#distributor' },
    { label: 'Provincial distributor', href: '#distributor' },
    { label: 'City distributor', href: '#distributor' },
    { label: 'Supply chain', href: '#distributor' },
    { label: 'Apply now', href: '#contact' },
  ],
}

const socialLinks = [
  {
    label: 'Facebook',
    href: 'https://www.facebook.com/HiromaPH',
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    ),
  },
  {
    label: 'TikTok',
    href: 'https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.tiktok.com%2F%40hiromaph%3F_r%3D1%26_t%3DZS-97y6HEuQdoj%26fbclid%3DIwZXh0bgNhZW0CMTAAYnJpZBExZmF3SzcxejFIMVFpa1NNNHNydGMGYXBwX2lkEDIyMjAzOTE3ODgyMDA4OTIAAR6eSJzhx7vQLmYSHNNwfWjvoDEw-bC9wVFfLGhZ2U1W_IR8EGGQDlmcdkelBw_aem_mGOSH_RmLN2fMPyWnRhXJg&h=AUAKWQ_eer-NawCXCurIPQYUigC4mkqdMORM9HPqM7f6j4mirEfeFb94NNYlWXfn-SwO-CeQ95xbGtT1apGjmLEEUFeOslrcPAR2R4AgvFkUItLTLmlchO9x3zX-_LO4_Hj0aOvpO152FzQ',
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
      </svg>
    ),
  },
]

export default function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="bg-[#060E1F]">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-10">

          {/* Brand Column */}
          <div className="md:col-span-2">
            
            {/* Logo Image */}
            <div className="mb-4">
              <Image 
                src="/hiroma-logo.jpg" // Replace with your actual path (e.g., /images/logo-white.svg)
                alt="Hiroma Logo"
                width={40}      // Adjust width as needed
                height={40}      // Adjust height as needed
                className="object-contain"
              />
            </div>

            <p className="text-white/40 text-xs italic mb-5">
              Long lasting oil rich fragrance
            </p>

            <p className="text-white/40 text-sm leading-relaxed mb-6 max-w-xs">
              Hiroma is a premium oil-based fragrance brand with an exclusive
              reseller and distributor network across the Philippines.
            </p>

            {/* Social Links */}
            <div className="flex gap-3">
              {socialLinks.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  aria-label={social.label}
                  className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:text-[#C9A84C] hover:border-[#C9A84C]/40 transition-all duration-150"
                >
                  {social.icon}
                </a>
              ))}
            </div>
          </div>

          {/* Links Columns */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h4 className="text-white text-xs font-semibold tracking-widest uppercase mb-4">
                {category}
              </h4>
              <div className="flex flex-col gap-2.5">
                {links.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    className="text-white/40 text-sm hover:text-[#C9A84C] transition-colors duration-150"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
          ))}

        </div>
      </div>

      <div className="border-t border-white/5" />

      <div className="max-w-7xl mx-auto px-6 py-5 flex flex-col md:flex-row items-center justify-between gap-3">
        <p className="text-white/25 text-xs">
          © {currentYear} Hiroma. All rights reserved.
        </p>

        <div className="flex items-center gap-6">
          <a href="#" className="text-white/25 text-xs hover:text-white/50 transition-colors">
            Privacy policy
          </a>
          <a href="#" className="text-white/25 text-xs hover:text-white/50 transition-colors">
            Terms of use
          </a>
          <a href="#contact" className="text-white/25 text-xs hover:text-white/50 transition-colors">
            Contact
          </a>
        </div>

        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-[#C9A84C]" />
          <p className="text-white/25 text-xs">
            Made with ❤️ in the Philippines
          </p>
        </div>
      </div>
    </footer>
  )
}