'use client'

import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import styles from './digital-id.module.css'

type Member = {
  member_id: string | null
  full_name: string
  username: string
  profile_photo: string | null
  status: string
  created_at: string
  reseller_profile: {
    package: { name: string } | null
    rank: string | null
    city_dist: { full_name: string; username: string; member_id?: string | null } | null
  } | null
  binary_tree_node: {
    sponsor: { full_name: string; username: string; member_id?: string | null } | null
  } | null
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function registeredDate(date: string) {
  return new Intl.DateTimeFormat('en-PH', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(date))
}

export default function DigitalIdPage() {
  const [member, setMember] = useState<Member | null>(null)
  const [error, setError] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [enlargedView, setEnlargedView] = useState<'id' | 'qr' | null>(null)
  const [showBack, setShowBack] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const cardRef = useRef<HTMLElement>(null)

  useEffect(() => {
    fetch('/api/reseller/profile')
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok || !data.user) throw new Error(data.error || 'Unable to load your digital ID.')
        setMember(data.user)
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load your digital ID.'))
  }, [])

  useEffect(() => {
    if (!member?.member_id) {
      return
    }

    const verificationUrl = `${window.location.origin}/verify/member/${encodeURIComponent(member.member_id)}`
    QRCode.toDataURL(verificationUrl, {
      width: 240,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#080f25', light: '#fffdf8' },
    }).then(setQrDataUrl).catch(() => setQrDataUrl(''))
  }, [member?.member_id])

  useEffect(() => {
    if (!enlargedView) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowBack(false)
        setEnlargedView(null)
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [enlargedView])

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>
  if (!member) return <div className="p-6 text-sm text-gray-400">Preparing your Digital ID...</div>

  const memberId = member.member_id || 'Pending activation'
  const memberType = member.reseller_profile?.package?.name || 'Member'
  const sponsor = member.binary_tree_node?.sponsor

  const handleDownloadId = async () => {
    if (!cardRef.current || isDownloading) return

    setDownloadError('')
    setIsDownloading(true)

    try {
      await document.fonts?.ready
      const { toPng } = await import('html-to-image')
      const imageUrl = await toPng(cardRef.current, {
        cacheBust: true,
        pixelRatio: 3,
      })
      const safeId = (member.member_id || member.username || 'member')
        .replace(/[^a-z0-9_-]+/gi, '-')
        .replace(/^-+|-+$/g, '')
      const downloadLink = document.createElement('a')
      downloadLink.href = imageUrl
      downloadLink.download = `Hiroma-Digital-ID-${safeId}.png`
      document.body.appendChild(downloadLink)
      downloadLink.click()
      downloadLink.remove()
    } catch (cause) {
      console.error('Unable to download Digital ID image.', cause)
      setDownloadError('Unable to prepare the ID image. Please try again.')
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>HIROMA MEMBER ACCOUNT</span>
          <h1>Digital ID</h1>
          <p>Your official, permanent Hiroma member identity.</p>
        </div>
        <button
          type="button"
          className={styles.downloadButton}
          onClick={handleDownloadId}
          disabled={isDownloading}
        >
          {isDownloading ? 'Preparing PNG…' : 'Download ID'}
        </button>
      </header>

      {downloadError ? <p className={styles.downloadError} role="alert">{downloadError}</p> : null}

      <section className={styles.cards} aria-label="Digital member identity card">
        <article ref={cardRef} className={`${styles.idCard} ${styles.frontCard}`}>
          <div className={styles.hologramSecurity} aria-hidden="true">
            <span className={styles.hologramSheen} />
            <span className={styles.hologramScanlines} />
            <span className={styles.hologramSeal}>
              <span className={styles.securityChip} />
              <small>AUTHENTIC</small>
            </span>
          </div>
          <div className={styles.officialBrand}>
            <div className={styles.officialCrest}>
                <img src="/hiroma-crest.png" alt="Hiroma" />
            </div>
            <div>
              <strong>HIROMA</strong>
              <span>Digital Member ID</span>
            </div>
          </div>

          <div className={styles.photoPanel}>
            <div className={styles.photoFrame}>
              {member.profile_photo ? <img src={member.profile_photo} alt="" /> : <span>{initials(member.full_name)}</span>}
            </div>
            <div className={styles.memberRibbon}>DIGITAL MEMBER</div>
          </div>

          <div className={styles.frontDetails}>
            <Detail label="Member ID" value={memberId} emphasis pending={!member.member_id} />
            <Detail label="Full name" value={member.full_name} />
            <Detail label="Username" value={`@${member.username}`} />
            <Detail label="Date registered" value={registeredDate(member.created_at)} />
            <Detail label="Member type" value={memberType} />
            <Detail
              label="Sponsor / Upline"
              value={sponsor?.full_name || 'No sponsor recorded'}
              secondary={sponsor?.member_id ? `Member ID: ${sponsor.member_id}` : undefined}
            />
          </div>

          <div className={styles.qrPanel}>
            {qrDataUrl ? <img src={qrDataUrl} alt={`Scan to verify member ${member.member_id}`} /> : <span>QR available after ID activation</span>}
            <strong>SCAN TO VERIFY</strong>
          </div>

          <div className={styles.peopleMark} aria-hidden="true">
            <svg viewBox="0 0 64 52" role="presentation">
              <circle cx="32" cy="15" r="8" />
              <path d="M17 42c0-9 6-16 15-16s15 7 15 16v3H17z" />
              <circle cx="14" cy="19" r="6" />
              <path d="M2 41c0-8 5-13 12-13 3 0 6 1 8 3-3 3-5 7-5 14H2z" />
              <circle cx="50" cy="19" r="6" />
              <path d="M47 45c0-7-2-11-5-14 2-2 5-3 8-3 7 0 12 5 12 13v4H47z" />
            </svg>
          </div>
          <div className={styles.crestMark} aria-hidden="true">H</div>

          <footer className={styles.frontFooter}>One Vision. One Community. <b>One Hiroma.</b></footer>
        </article>
      </section>

      <div className={styles.enlargeActions} aria-label="Digital ID viewing options">
        <button type="button" className={styles.enlargeButton} onClick={() => { setShowBack(false); setEnlargedView('id') }}>Enlarge ID</button>
        <button type="button" className={styles.enlargeButton} onClick={() => { setShowBack(false); setEnlargedView('qr') }} disabled={!qrDataUrl}>Enlarge QR</button>
      </div>

      {enlargedView ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => { setShowBack(false); setEnlargedView(null) }}>
          <section
            className={`${styles.enlargeModal} ${enlargedView === 'id' ? styles.idModal : styles.qrModal}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={enlargedView === 'id' ? 'enlarge-id-title' : 'enlarge-qr-title'}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h2 id={enlargedView === 'id' ? 'enlarge-id-title' : 'enlarge-qr-title'}>{enlargedView === 'id' ? 'Digital Member ID' : 'Member verification QR'}</h2>
              <button type="button" className={styles.closeModal} onClick={() => setEnlargedView(null)} aria-label="Close enlarged view">×</button>
            </div>

            {enlargedView === 'id' ? (
              <div className={styles.modalCardViewport}>
                <div className={`${styles.flipScene} ${showBack ? styles.isFlipped : ''}`}>
                  <div className={styles.flipInner}>
                    <article
                      className={`${styles.idCard} ${styles.frontCard} ${styles.flipFace} ${styles.flipFront}`}
                      role="button"
                      tabIndex={0}
                      aria-label="Flip to the back of your digital ID"
                      onClick={() => setShowBack((isBack) => !isBack)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setShowBack((isBack) => !isBack)
                        }
                      }}
                    >
                  <div className={styles.hologramSecurity} aria-hidden="true">
                    <span className={styles.hologramSheen} />
                    <span className={styles.hologramScanlines} />
                    <span className={styles.hologramSeal}>
                      <span className={styles.securityChip} />
                      <small>AUTHENTIC</small>
                    </span>
                  </div>
                  <div className={styles.officialBrand}>
                    <div className={styles.officialCrest}><img src="/hiroma-crest.png" alt="Hiroma" /></div>
                    <div><strong>HIROMA</strong><span>Digital Member ID</span></div>
                  </div>
                  <div className={styles.photoPanel}>
                    <div className={styles.photoFrame}>{member.profile_photo ? <img src={member.profile_photo} alt="" /> : <span>{initials(member.full_name)}</span>}</div>
                    <div className={styles.memberRibbon}>DIGITAL MEMBER</div>
                  </div>
                  <div className={styles.frontDetails}>
                    <Detail label="Member ID" value={memberId} emphasis pending={!member.member_id} />
                    <Detail label="Full name" value={member.full_name} />
                    <Detail label="Username" value={`@${member.username}`} />
                    <Detail label="Date registered" value={registeredDate(member.created_at)} />
                    <Detail label="Member type" value={memberType} />
                    <Detail label="Sponsor / Upline" value={sponsor?.full_name || 'No sponsor recorded'} secondary={sponsor?.member_id ? `Member ID: ${sponsor.member_id}` : undefined} />
                  </div>
                  <div className={styles.qrPanel}>{qrDataUrl ? <img src={qrDataUrl} alt={`Scan to verify member ${member.member_id}`} /> : <span>QR available after ID activation</span>}<strong>SCAN TO VERIFY</strong></div>
                  <div className={styles.peopleMark} aria-hidden="true"><svg viewBox="0 0 64 52" role="presentation"><circle cx="32" cy="15" r="8" /><path d="M17 42c0-9 6-16 15-16s15 7 15 16v3H17z" /><circle cx="14" cy="19" r="6" /><path d="M2 41c0-8 5-13 12-13 3 0 6 1 8 3-3 3-5 7-5 14H2z" /><circle cx="50" cy="19" r="6" /><path d="M47 45c0-7-2-11-5-14 2-2 5-3 8-3 7 0 12 5 12 13v4H47z" /></svg></div>
                  <div className={styles.crestMark} aria-hidden="true">H</div>
                      <footer className={styles.frontFooter}>One Vision. One Community. <b>One Hiroma.</b></footer>
                    </article>
                    <article
                      className={`${styles.idCard} ${styles.backCard} ${styles.flipFace} ${styles.flipBack}`}
                      role="button"
                      tabIndex={0}
                      aria-label="Flip to the front of your digital ID"
                      onClick={() => setShowBack((isBack) => !isBack)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setShowBack((isBack) => !isBack)
                        }
                      }}
                    >
                      <div className={styles.backBrand}>
                        <div className={styles.backCrest}><img src="/hiroma-crest.png" alt="" /></div>
                        <span>HIROMA DIGITAL</span>
                      </div>
                      <div className={styles.backContent}>
                        <span>Digital Member ID</span>
                        <strong>Back ID design</strong>
                        <p>This side is reserved for future member information.</p>
                      </div>
                      <footer className={styles.backFooter}>One Vision. One Community. <b>One Hiroma.</b></footer>
                    </article>
                  </div>
                </div>
                <div className={styles.modalCardActions}>
                  <button type="button" className={styles.modalActionButton} onClick={() => setShowBack((isBack) => !isBack)}>
                    {showBack ? 'Show front ID' : 'Show back ID'}
                  </button>
                  <button type="button" className={styles.modalActionButton} onClick={() => { setShowBack(false); setEnlargedView('qr') }} disabled={!qrDataUrl}>
                    Enlarge QR
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.largeQrContent}>
                {qrDataUrl ? <img src={qrDataUrl} alt={`Large verification QR for ${member.full_name}`} /> : null}
                <strong>{memberId}</strong>
                <p>Scan this code to verify the member’s Hiroma Digital ID.</p>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </main>
  )
}

function Detail({ label, value, emphasis, pending, secondary }: { label: string; value: string; emphasis?: boolean; pending?: boolean; secondary?: string }) {
  return <div className={`${styles.detail} ${emphasis ? styles.idDetail : ''}`}><span>{label}</span><strong className={pending ? styles.pending : undefined}>{value}</strong>{secondary ? <small className={styles.detailSecondary}>{secondary}</small> : null}</div>
}
