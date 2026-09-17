'use client'

import { useId, useState, type ComponentProps } from 'react'

export function PasswordEyeIcon({ visible }: { visible: boolean }) {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {visible ? <><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A11 11 0 0 1 12 5c7 0 10 7 10 7a17 17 0 0 1-3.2 4.3M6.3 6.3C3.4 8.2 2 12 2 12s3 7 10 7a11 11 0 0 0 5.7-1.7"/></> : <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>}
  </svg>
}

export default function PasswordInput({ type = 'password', className = '', id, ...props }: ComponentProps<'input'>) {
  const [visible, setVisible] = useState(false)
  const generatedId = useId()
  if (type !== 'password') return <input {...props} id={id} type={type} className={className}/>
  const inputId = id || generatedId
  const layoutClasses = className.split(/\s+/).filter(value => /(^|:)col-span-|(^|:)flex-1$/.test(value)).join(' ')
  return <span className={`relative block min-w-0 w-full ${layoutClasses}`}>
    <input {...props} id={inputId} type={visible ? 'text' : 'password'} className={`w-full min-w-0 ${className}`} style={{ ...props.style, paddingRight: '3rem' }}/>
    <button type="button" aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible} aria-controls={inputId} title={visible ? 'Hide password' : 'Show password'} disabled={props.disabled} onClick={() => setVisible(current => !current)} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-gray-400 hover:text-[#C9A84C] focus-visible:outline-2 focus-visible:outline-[#C9A84C] disabled:opacity-50">
      <PasswordEyeIcon visible={visible}/>
    </button>
  </span>
}
