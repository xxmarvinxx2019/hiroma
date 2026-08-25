import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const widget = readFileSync('src/app/components/hiro/HiroFloatingChat.tsx', 'utf8')

test('Hiro uses an English dismissible desktop greeting', () => {
  assert.match(widget, /Hi! I&apos;m Hiro\. Do you have a question\? 👋/)
  assert.match(widget, /onClick=\{\(\) => setGreeted\(true\)\}/)
  assert.match(widget, /aria-label="Dismiss Hiro greeting"/)
})

test('mobile defaults to a compact launcher while desktop stays animated and unobtrusive', () => {
  assert.match(widget, /hidden w-52[\s\S]*sm:block/)
  assert.match(widget, /h-16 w-16[\s\S]*sm:h-24 sm:w-24/)
  assert.match(widget, /window\.setTimeout\(\(\) => setGreeted\(true\), 8000\)/)
  assert.match(widget, /sm:\[animation:bounce_3\.2s_ease-in-out_infinite\]/)
})
