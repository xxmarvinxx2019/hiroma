import assert from 'node:assert/strict'
import test from 'node:test'
import { readSettingsResponse } from '../src/app/lib/settingsResponse'

test('settings failures explain empty and HTML server responses without JSON parser errors', async () => {
  for (const body of ['', '<html>Server error</html>']) {
    await assert.rejects(readSettingsResponse(new Response(body, { status: 500 }), 'Unable to load settings.'), /Unable to load settings.*HTTP 500/)
  }
})

test('settings responses preserve API errors and successful data', async () => {
  await assert.rejects(readSettingsResponse(Response.json({ error: 'Admin owner access is required.' }, { status: 403 }), 'Unable to load settings.'), /Admin owner access is required/)
  assert.deepEqual(await readSettingsResponse(Response.json({ years: 3 }), 'Unable to load settings.'), { years: 3 })
  await assert.rejects(readSettingsResponse(Response.json(null), 'Unable to load settings.'), /invalid response/)
})
