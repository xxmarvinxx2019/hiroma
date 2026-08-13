'use client'

import { useState } from 'react'

export const PROFILE_PHOTO_CHANGE_EVENT = 'hiroma-profile-photo-change'

export default function ProfilePhotoUploader({ profilePhoto, fullName, onChange }: { profilePhoto: string | null; fullName: string; onChange: (profilePhoto: string | null) => void }) {
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')

  const handlePhotoChange = async (file: File | undefined) => {
    setError('')
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10_000_000) return setError('Choose a JPEG, PNG, or WebP image up to 10 MB.')
    setProcessing(true)
    try {
      const bitmap = await createImageBitmap(file)
      const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas is unavailable.')
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close()
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.78))
      if (!blob || blob.size > 400 * 1024) throw new Error('Photo is too large after compression.')
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to read the photo.')); reader.onerror = () => reject(new Error('Unable to read the photo.')); reader.readAsDataURL(blob) })
      const response = await fetch('/api/reseller/profile/photo', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile_photo: dataUrl }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to update the photo.')
      const nextPhoto = data.profile_photo || null
      onChange(nextPhoto)
      window.dispatchEvent(new CustomEvent(PROFILE_PHOTO_CHANGE_EVENT, { detail: nextPhoto }))
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to update the photo.') } finally { setProcessing(false) }
  }

  return <div className="mb-5 flex flex-wrap items-center gap-4">
    <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 border-[#C9A84C]/40 bg-[#0D1B3E]/5">
      {profilePhoto ? <img src={profilePhoto} alt="Profile preview" className="h-full w-full object-cover" /> : <span className="text-xl font-semibold text-[#C9A84C]">{fullName.charAt(0) || 'H'}</span>}
    </div>
    <div className="min-w-0">
      <p className="text-sm font-medium text-[#0D1B3E]">Profile photo</p>
      <p className="mt-0.5 text-xs text-gray-400">JPEG, PNG, or WebP up to 10 MB. Automatically resized and compressed.</p>
      <label className={`mt-2 inline-block text-xs font-medium text-[#C9A84C] ${processing ? 'cursor-wait opacity-60' : 'cursor-pointer hover:underline'}`}>
        {processing ? 'Uploading...' : profilePhoto ? 'Change photo' : 'Add photo'}
        <input type="file" accept="image/jpeg,image/png,image/webp" disabled={processing} className="sr-only" onChange={(event) => handlePhotoChange(event.target.files?.[0])} />
      </label>
      {error && <p className="mt-2 text-xs text-[#a03030]">{error}</p>}
    </div>
  </div>
}
