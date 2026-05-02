import Navbar from './components/landing/Navbar'
import Hero from './components/landing/Hero'
import Products from './components/landing/Products'
import Opportunity from './components/landing/Opportunity'
import Distributor from './components/landing/Distributor'
import Contact from './components/landing/Contact'
import Footer from './components/landing/Footer'

export const metadata = {
  title: 'Hiroma — Long lasting oil rich fragrance',
  description:
    'Hiroma brings you world-class oil-rich fragrances while giving you the opportunity to build a business and earn through our exclusive reseller network.',
}

export default function LandingPage() {
  return (
    <main>
      <Navbar />
      <Hero />
      <Products />
      <Opportunity />
      <Distributor />
      <Contact />
      <Footer />
    </main>
  )
}