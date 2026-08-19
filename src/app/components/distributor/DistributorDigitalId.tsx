'use client'

import { useEffect, useRef, useState, type Ref } from 'react'
import QRCode from 'qrcode'
import styles from '@/app/dashboard/reseller/digital-id/digital-id.module.css'

type Distributor = {
  member_id: string | null; full_name: string; username: string; profile_photo: string | null
  status: string; created_at: string; is_staff?: boolean
  distributor_profile: {
    dist_level: 'regional' | 'provincial' | 'city' | 'branch'; coverage_area: string; is_active: boolean
    fulfillment_outlet_name?: string | null; fulfillment_outlet_city_muni_name?: string | null
  } | null
}

const CARD_WIDTH = 860
const CARD_HEIGHT = CARD_WIDTH * 638 / 1011
const PORTRAIT_QUERY = '(max-width: 760px) and (orientation: portrait)'
const levelLabel = (level?: string) => level ? `${level.charAt(0).toUpperCase()}${level.slice(1)} Distributor` : 'Distributor'
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase()
const dateLabel = (date: string) => new Intl.DateTimeFormat('en-PH', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(date))

export default function DistributorDigitalId() {
  const [account, setAccount] = useState<Distributor | null>(null)
  const [error, setError] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [enlargedView, setEnlargedView] = useState<'id' | 'qr' | null>(null)
  const [showBack, setShowBack] = useState(false)
  const [cardScale, setCardScale] = useState(1)
  const [rotateCard, setRotateCard] = useState(false)
  const [modalScale, setModalScale] = useState(1)
  const [rotateModal, setRotateModal] = useState(false)
  const cardRef = useRef<HTMLElement>(null)
  const cardStageRef = useRef<HTMLElement>(null)
  const modalStageRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    const stage = cardStageRef.current
    if (!stage) return
    const update = () => {
      const rotate = window.matchMedia(PORTRAIT_QUERY).matches
      setRotateCard(rotate)
      setCardScale(Math.min(1, stage.clientWidth / (rotate ? CARD_HEIGHT : CARD_WIDTH)))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    window.addEventListener('orientationchange', update)
    return () => { observer.disconnect(); window.removeEventListener('orientationchange', update) }
  }, [account])

  useEffect(() => {
    if (enlargedView !== 'id') return
    const stage = modalStageRef.current
    if (!stage) return
    const update = () => {
      const rotate = window.matchMedia(PORTRAIT_QUERY).matches
      const computed = window.getComputedStyle(stage)
      const contentWidth = stage.clientWidth - Number.parseFloat(computed.paddingLeft || '0') - Number.parseFloat(computed.paddingRight || '0')
      const widthScale = contentWidth / (rotate ? CARD_HEIGHT : CARD_WIDTH)
      const heightScale = (window.innerHeight - (rotate ? 170 : 150)) / (rotate ? CARD_WIDTH : CARD_HEIGHT)
      setRotateModal(rotate)
      setModalScale(Math.min(1, widthScale, heightScale))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    window.addEventListener('orientationchange', update)
    return () => { observer.disconnect(); window.removeEventListener('orientationchange', update) }
  }, [enlargedView])

  useEffect(() => {
    if (!enlargedView) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setShowBack(false); setEnlargedView(null) }
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [enlargedView])

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
  const distributorId = account.member_id || 'Pending activation'

  const renderCard = (ref: Ref<HTMLElement> | undefined, extraClass: string, interactive = false) => (
    <article ref={ref} className={`${styles.idCard} ${styles.frontCard} ${extraClass}`}
      role={interactive ? 'button' : undefined} tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? 'Flip to the back of your distributor ID' : undefined}
      onClick={interactive ? () => setShowBack(value => !value) : undefined}
      onKeyDown={interactive ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setShowBack(value => !value) } } : undefined}>
      <div className={styles.hologramSecurity} aria-hidden="true"><span className={styles.hologramSheen}/><span className={styles.hologramScanlines}/><span className={styles.hologramSeal}><span className={styles.securityChip}/><small>AUTHORIZED</small></span></div>
      <div className={styles.officialBrand}><div className={styles.officialCrest}><img src="/hiroma-crest.png" alt="Hiroma" /></div><div><strong>HIROMA</strong><span>Distributor Digital ID</span></div></div>
      <div className={styles.photoPanel}><div className={styles.photoFrame}>{account.profile_photo ? <img src={account.profile_photo} alt="" /> : <span>{initials(account.full_name)}</span>}</div><div className={styles.memberRibbon}>AUTHORIZED DISTRIBUTOR</div></div>
      <div className={styles.frontDetails}>
        <Detail label="Distributor ID" value={distributorId} emphasis pending={!account.member_id}/><Detail label="Full name" value={account.full_name}/>
        <Detail label="Distributor level" value={levelLabel(profile.dist_level)}/><Detail label="Coverage area" value={profile.coverage_area}/>
        <Detail label="Date authorized" value={dateLabel(account.created_at)}/><Detail label="Authorized outlet" value={outlet || 'No outlet recorded'}/>
      </div>
      <div className={styles.qrPanel}>{qrDataUrl ? <img src={qrDataUrl} alt={`Scan to verify distributor ${account.member_id}`}/> : <span>QR available after ID activation</span>}<strong>SCAN TO VERIFY</strong></div>
      <div className={styles.peopleMark} aria-hidden="true"><svg viewBox="0 0 64 52"><circle cx="32" cy="15" r="8"/><path d="M17 42c0-9 6-16 15-16s15 7 15 16v3H17z"/></svg></div><div className={styles.crestMark} aria-hidden="true">H</div>
      <footer className={styles.frontFooter}>{active ? 'Verified active authorization' : 'Authorization inactive'} <b>One Hiroma.</b></footer>
    </article>
  )

  return <main className={styles.page}>
    <header className={styles.header}><div><span className={styles.eyebrow}>AUTHORIZED HIROMA DISTRIBUTOR</span><h1>Digital ID</h1><p>Your official distributor authorization credential.</p></div><button type="button" className={styles.downloadButton} onClick={download} disabled={downloading}>{downloading ? 'Preparing PNG...' : 'Download ID'}</button></header>
    <section ref={cardStageRef} className={styles.cards} aria-label="Distributor Digital ID" style={{ height: `${(rotateCard ? CARD_WIDTH : CARD_HEIGHT) * cardScale}px` }}>
      <div className={styles.scaledCardCanvas} style={{ transform: rotateCard ? `translateX(${CARD_HEIGHT * cardScale}px) rotate(90deg) scale(${cardScale})` : `scale(${cardScale})` }}>{renderCard(cardRef, styles.scaledCard)}</div>
    </section>
    <div className={styles.enlargeActions} aria-label="Distributor ID viewing options"><button type="button" className={styles.enlargeButton} onClick={() => { setShowBack(false); setEnlargedView('id') }}>Enlarge ID</button><button type="button" className={styles.enlargeButton} onClick={() => { setShowBack(false); setEnlargedView('qr') }} disabled={!qrDataUrl}>Enlarge QR</button></div>

    {enlargedView ? <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => { setShowBack(false); setEnlargedView(null) }}>
      <section className={`${styles.enlargeModal} ${enlargedView === 'id' ? styles.idModal : styles.qrModal}`} role="dialog" aria-modal="true" aria-labelledby={enlargedView === 'id' ? 'distributor-id-title' : 'distributor-qr-title'} onMouseDown={event => event.stopPropagation()}>
        <div className={styles.modalHeader}><h2 id={enlargedView === 'id' ? 'distributor-id-title' : 'distributor-qr-title'}>{enlargedView === 'id' ? 'Distributor Digital ID' : 'Distributor verification QR'}</h2><button type="button" className={styles.closeModal} onClick={() => setEnlargedView(null)} aria-label="Close enlarged view">×</button></div>
        {enlargedView === 'id' ? <div ref={modalStageRef} className={styles.modalCardViewport}>
          <div className={styles.modalCardStage} style={{ height: `${(rotateModal ? CARD_WIDTH : CARD_HEIGHT) * modalScale}px` }}><div className={`${styles.flipScene} ${showBack ? styles.isFlipped : ''}`} style={{ transform: rotateModal ? `translateX(${CARD_HEIGHT * modalScale}px) rotate(90deg) scale(${modalScale})` : `scale(${modalScale})` }}><div className={styles.flipInner}>
            {renderCard(undefined, `${styles.flipFace} ${styles.flipFront}`, true)}
            <article className={`${styles.idCard} ${styles.backCard} ${styles.flipFace} ${styles.flipBack}`} role="button" tabIndex={0} aria-label="Flip to the front of your distributor ID" onClick={() => setShowBack(value => !value)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setShowBack(value => !value) } }}>
              <div className={styles.backBrand}><div className={styles.backCrest}><img src="/hiroma-crest.png" alt="" /></div><span>HIROMA DIGITAL</span></div><div className={styles.backContent}><span>Distributor Digital ID</span><strong>Authorized distributor</strong><p>This credential confirms the distributor&apos;s authorized Hiroma coverage and identity.</p></div><footer className={styles.backFooter}>Verified authorization. <b>One Hiroma.</b></footer>
            </article>
          </div></div></div>
          <div className={styles.modalCardActions}><button type="button" className={styles.modalActionButton} onClick={() => setShowBack(value => !value)}>{showBack ? 'Show front ID' : 'Show back ID'}</button><button type="button" className={styles.modalActionButton} onClick={() => { setShowBack(false); setEnlargedView('qr') }} disabled={!qrDataUrl}>Enlarge QR</button></div>
        </div> : <div className={styles.largeQrContent}>{qrDataUrl ? <img src={qrDataUrl} alt={`Large verification QR for ${account.full_name}`} /> : null}<strong>{distributorId}</strong><p>Scan this code to verify the distributor&apos;s Hiroma authorization.</p></div>}
      </section>
    </div> : null}
  </main>
}

function Detail({ label, value, emphasis, pending }: { label: string; value: string; emphasis?: boolean; pending?: boolean }) {
  return <div className={`${styles.detail} ${emphasis ? styles.idDetail : ''}`}><span>{label}</span><strong className={pending ? styles.pending : undefined}>{value}</strong></div>
}
