'use client'

import { useState } from 'react'

const interestOptions = [
  'Becoming a reseller',
  'Becoming a city distributor',
  'Becoming a provincial distributor',
  'Becoming a regional distributor',
  'Product inquiry',
  'Other',
]

const contactInfo = [
  'Inquiries are reviewed within 24–48 hours',
  'Reseller registration is done through your city distributor',
  'Distributor applications require a signed contract',
  'Available nationwide across the Philippines',
]

export default function Contact() {
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    mobile: '',
    email: '',
    interest: 'Becoming a reseller',
    message: '',
  })
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    setForm({ ...form, [e.target.name]: e.target.value })
    setError('')
  }

  const handleSubmit = async (e: React.MouseEvent) => {
    e.preventDefault()

    if (!form.first_name || !form.last_name || !form.mobile) {
      setError('Please fill in all required fields.')
      return
    }

    setLoading(true)

    // Simulate submission — replace with actual API call later
    await new Promise((resolve) => setTimeout(resolve, 1500))

    setLoading(false)
    setSuccess(true)
    setForm({
      first_name: '',
      last_name: '',
      mobile: '',
      email: '',
      interest: 'Becoming a reseller',
      message: '',
    })
  }

  return (
    <section id="contact" className="bg-[#0D1B3E] py-16 px-6">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <p className="text-[#C9A84C] text-xs font-semibold tracking-[0.2em] uppercase text-center mb-2">
          Get in touch
        </p>
        <h2 className="text-2xl font-semibold text-white text-center mb-2">
          Contact Hiroma
        </h2>
        <p className="text-sm text-white/50 text-center leading-relaxed max-w-lg mx-auto mb-12">
          Whether you're interested in becoming a reseller, a distributor, or
          simply want to know more about our products — we'd love to hear from
          you.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-start">

          {/* Left — Info */}
          <div>
            <h3 className="text-white font-semibold text-lg mb-3">
              We're here to help
            </h3>
            <p className="text-white/50 text-sm leading-relaxed mb-8">
              Fill out the form and our team will get back to you as soon as
              possible. You can also visit your nearest city distributor to get
              started immediately.
            </p>

            {/* Contact Info List */}
            <div className="flex flex-col gap-4 mb-10">
              {contactInfo.map((info) => (
                <div key={info} className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#C9A84C] flex-shrink-0 mt-1.5" />
                  <p className="text-white/60 text-sm">{info}</p>
                </div>
              ))}
            </div>

            {/* Interest Quick Links */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-5">
              <p className="text-white/50 text-xs uppercase tracking-widest mb-4">
                I am interested in
              </p>
              <div className="flex flex-wrap gap-2">
                {interestOptions.map((option) => (
                  <button
                    key={option}
                    onClick={() => setForm({ ...form, interest: option })}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-all duration-150 cursor-pointer ${
                      form.interest === option
                        ? 'bg-[#C9A84C] text-[#0D1B3E] border-[#C9A84C] font-semibold'
                        : 'bg-transparent text-white/50 border-white/20 hover:border-[#C9A84C] hover:text-[#C9A84C]'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right — Form */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-6">

            {success ? (
              /* Success State */
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="text-5xl mb-4">✅</div>
                <h3 className="text-white font-semibold text-lg mb-2">
                  Inquiry sent!
                </h3>
                <p className="text-white/50 text-sm leading-relaxed max-w-xs">
                  Thank you for reaching out. Our team will get back to you
                  within 24–48 hours.
                </p>
                <button
                  onClick={() => setSuccess(false)}
                  className="mt-6 text-[#C9A84C] text-sm hover:underline cursor-pointer"
                >
                  Send another inquiry
                </button>
              </div>
            ) : (
              /* Form */
              <div className="flex flex-col gap-4">
                <h3 className="text-white font-semibold text-base mb-1">
                  Send us a message
                </h3>

                {/* Name Row */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-white/50 mb-1">
                      First name <span className="text-[#C9A84C]">*</span>
                    </label>
                    <input
                      name="first_name"
                      value={form.first_name}
                      onChange={handleChange}
                      placeholder="Juan"
                      className="w-full bg-white/7 border border-white/15 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-[#C9A84C] transition-colors placeholder:text-white/30"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-white/50 mb-1">
                      Last name <span className="text-[#C9A84C]">*</span>
                    </label>
                    <input
                      name="last_name"
                      value={form.last_name}
                      onChange={handleChange}
                      placeholder="dela Cruz"
                      className="w-full bg-white/7 border border-white/15 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-[#C9A84C] transition-colors placeholder:text-white/30"
                    />
                  </div>
                </div>

                {/* Mobile */}
                <div>
                  <label className="block text-xs text-white/50 mb-1">
                    Mobile number <span className="text-[#C9A84C]">*</span>
                  </label>
                  <input
                    name="mobile"
                    value={form.mobile}
                    onChange={handleChange}
                    placeholder="+63 9XX XXX XXXX"
                    className="w-full bg-white/7 border border-white/15 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-[#C9A84C] transition-colors placeholder:text-white/30"
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-xs text-white/50 mb-1">
                    Email address
                    <span className="text-white/30 ml-1">(optional)</span>
                  </label>
                  <input
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    placeholder="juan@email.com"
                    className="w-full bg-white/7 border border-white/15 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-[#C9A84C] transition-colors placeholder:text-white/30"
                  />
                </div>

                {/* Interest */}
                <div>
                  <label className="block text-xs text-white/50 mb-1">
                    I am interested in
                  </label>
                  <select
                    name="interest"
                    value={form.interest}
                    onChange={handleChange}
                    className="w-full bg-white/7 border border-white/15 rounded-lg px-3 py-2 text-sm text-white/70 outline-none focus:border-[#C9A84C] transition-colors"
                  >
                    {interestOptions.map((option) => (
                      <option
                        key={option}
                        value={option}
                        className="bg-[#0D1B3E] text-white"
                      >
                        {option}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Message */}
                <div>
                  <label className="block text-xs text-white/50 mb-1">
                    Message
                    <span className="text-white/30 ml-1">(optional)</span>
                  </label>
                  <textarea
                    name="message"
                    value={form.message}
                    onChange={handleChange}
                    placeholder="Tell us more about your interest..."
                    rows={3}
                    className="w-full bg-white/7 border border-white/15 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-[#C9A84C] transition-colors placeholder:text-white/30 resize-none"
                  />
                </div>

                {/* Error */}
                {error && (
                  <p className="text-red-400 text-xs">{error}</p>
                )}

                {/* Submit */}
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="w-full bg-[#C9A84C] text-[#0D1B3E] font-semibold text-sm rounded-lg py-3 hover:bg-[#E8C96A] transition-all duration-150 active:scale-95 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? 'Sending...' : 'Send inquiry'}
                </button>

                <p className="text-white/30 text-xs text-center">
                  We typically respond within 24–48 hours.
                </p>
              </div>
            )}

          </div>
        </div>
      </div>
    </section>
  )
}