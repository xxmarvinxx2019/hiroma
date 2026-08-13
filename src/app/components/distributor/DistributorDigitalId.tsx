'use client'

import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import styles from '@/app/dashboard/reseller/digital-id/digital-id.module.css'

type Distributor = {
  member_id: string | null
  full_name: string
  username: string
  profile_photo: string | null
  status: string
  created_at: string
  distributor_profile: {
    dist_level: 'regional' | 'provincial' | 'city' | 'branch'
    coverage_area: string
    is_active: boolean
    fulfillment_outlet_name?: string | null
    fulfillment_outlet_city_muni_name?: string | null
  } | null
  is_staff?: boolean
}

const levelLabel = (level?: string) => level ? `${level.charAt(0).toUpperCase()}${level.slice(1)} Distributor` : 'Distributor'
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase()
const dateLabel = (date: string) => new Intl.DateTimeFormat('en-PH', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(date))

export default function DistributorDigitalId() {
  const [account, setAccount] = useState<Distributor | null>(null)
  const [error, setError] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [downloading, setDownloading] = useState(false)
  const cardRef = useRef<HTMLElement>(null)

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' }).then(async response => {
      const data = await response.json()
      if (!response.ok || !data.user) throw new Error(data.error || 'Unable to load your Digital ID.')
      if (data.user.is_staff || !data.user.distributor_profile) throw new Error('Digital ID is available to distributor owners only.')
      setAccount(data.user)
    }).catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load your Digital ID.'))
  }, [])

  useEffect(() => {
    if (!account?.member_id) return
    const url = `${window.location.origin}/verify/distributor/${encodeURIComponent(account.member_id)}`
    QRCode.toDataURL(url, { width: 240, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#080f25', light: '#fffdf8' } }).then(setQrDataUrl).catch(() => setQrDataUrl(''))
  }, [account?.member_id])

  const download = async () => {
    if (!cardRef.current || downloading) return
    setDownloading(true)
    try {
      await document.fonts?.ready
      const { toPng } = await import('html-to-image')
      const imageUrl = await toPng(cardRef.current, { cacheBust: true, pixelRatio: 3 })
      const link = document.createElement('a')
      link.href = imageUrl
      link.download = `Hiroma-Distributor-ID-${account?.member_id || account?.username || 'distributor'}.png`
      document.body.appendChild(link); link.click(); link.remove()
    } catch { setError('Unable to prepare the ID image. Please try again.') }
    finally { setDownloading(false) }
  }

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>
  if (!account) return <div className="p-6 text-sm text-gray-400">Preparing your Distributor Digital ID...</div>
  const profile = account.distributor_profile!
  const active = account.status === 'active' && profile.is_active
  const outlet = [profile.fulfillment_outlet_name, profile.fulfillment_outlet_city_muni_name].filter(Boolean).join(' / ')

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>AUTHORIZED HIROMA DISTRIBUTOR</span><h1>Digital ID</h1><p>Your official distributor authorization credential.</p></div>
      <button type="button" className={styles.downloadButton} onClick={download} disabled={downloading}>{downloading ? 'Preparing PNG...' : 'Download ID'}</button>
    </header>
    <section className={styles.cards} aria-label="Distributor Digital ID">
      <article ref={cardRef} className={`${styles.idCard} ${styles.frontCard}`}>
        <div className={styles.hologramSecurity} aria-hidden="true"><span className={styles.hologramSheen}/><span className={styles.hologramScanlines}/><span className={styles.hologramSeal}><span className={styles.securityChip}/><small>AUTHORIZED</small></span></div>
        <div className={styles.officialBrand}><div className={styles.officialCrest}><img src="/hiroma-crest.png" alt="Hiroma" /></div><div><strong>HIROMA</strong><span>Distributor Digital ID</span></div></div>
        <div className={styles.photoPanel}><div className={styles.photoFrame}>{account.profile_photo ? <img src={account.profile_photo} alt="" /> : <span>{initials(account.full_name)}</span>}</div><div className={styles.memberRibbon}>AUTHORIZED DISTRIBUTOR</div></div>
        <div className={styles.frontDetails}>
          <Detail label="Distributor ID" value={account.member_id || 'Pending activation'} emphasis pending={!account.member_id}/>
          <Detail label="Full name" value={account.full_name}/>
          <Detail label="Distributor level" value={levelLabel(profile.dist_level)}/>
          <Detail label="Coverage area" value={profile.coverage_area}/>
          <Detail label="Date authorized" value={dateLabel(account.created_at)}/>
          <Detail label="Authorized outlet" value={outlet || 'No outlet recorded'}/>
        </div>
        <div className={styles.qrPanel}>{qrDataUrl ? <img src={qrDataUrl} alt={`Scan to verify distributor ${account.member_id}`}/> : <span>QR available after ID activation</span>}<strong>SCAN TO VERIFY</strong></div>
        <div className={styles.peopleMark} aria-hidden="true"><svg viewBox="0 0 64 52"><circle cx="32" cy="15" r="8"/><path d="M17 42c0-9 6-16 15-16s15 7 15 16v3H17z"/></svg></div><div className={styles.crestMark} aria-hidden="true">H</div>
        <footer className={styles.frontFooter}>{active ? 'Verified active authorization' : 'Authorization inactive'} <b>One Hiroma.</b></footer>
      </article>
    </section>
  </main>
}

function Detail({ label, value, emphasis, pending }: { label: string; value: string; emphasis?: boolean; pending?: boolean }) {
  return <div className={`${styles.detail} ${emphasis ? styles.idDetail : ''}`}><span>{label}</span><strong className={pending ? styles.pending : undefined}>{value}</strong></div>
}