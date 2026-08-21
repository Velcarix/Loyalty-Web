import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

async function source() {
  return readFile(new URL('../mostrador.html', import.meta.url), 'utf8')
}

test('mostrador is a standalone PWA with a local QR fallback', async () => {
  const page = await source()
  const manifest = await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8')
  assert.match(page, /<link rel="manifest" href="\.\/manifest\.webmanifest"/)
  assert.match(page, /<script src="\.\/assets\/jsqr\.min\.js"><\/script>/)
  assert.match(page, /'BarcodeDetector' in window/)
  assert.match(page, /typeof window\.jsQR === 'function'/)
  assert.doesNotMatch(page, /serviceWorker\.register|cdn\./i)
  assert.match(manifest, /"display": "standalone"/)
})

test('mostrador guards camera lifecycle and unsupported browsers', async () => {
  const page = await source()
  assert.match(page, /window\.isSecureContext \|\| !navigator\.mediaDevices\?\.getUserMedia/)
  assert.match(page, /facingMode: \{ ideal: 'environment' \}/)
  assert.match(page, /stream\.getTracks\(\)\.forEach\(track => track\.stop\(\)\)/)
  assert.match(page, /document\.addEventListener\('visibilitychange'/)
  assert.match(page, /window\.addEventListener\('pagehide', stopScanner\)/)
  assert.match(page, /navigator\.mediaDevices\.enumerateDevices\(\)/)
})

test('mostrador preserves the verification idempotency contract in memory', async () => {
  const page = await source()
  assert.match(page, /eventUuid: crypto\.randomUUID\(\)/)
  assert.match(page, /eventUuid: session\.eventUuid/)
  assert.match(page, /verificationMethod: session\.verificationMethod/)
  assert.match(page, /verificationGrant: session\.verificationGrant/)
  assert.match(page, /DAILY_LIMIT_REACHED/)
  assert.match(page, /VERIFICATION_FAILED/)
  assert.doesNotMatch(page, /localStorage\.setItem\([^\n]+verificationGrant/)
})

test('mostrador only persists its allowed device fields and removes pairing hashes', async () => {
  const page = await source()
  const allowed = page.match(/const allowed = \{([\s\S]*?)\n\s*\}/)?.[1] || ''
  assert.match(page, /history\.replaceState\(null, '', `\$\{location\.pathname\}\$\{location\.search\}`\)/)
  assert.match(allowed, /deviceToken/)
  assert.match(allowed, /deviceId/)
  assert.match(allowed, /merchantName/)
  assert.match(allowed, /sessionSeconds/)
  assert.match(allowed, /programId/)
  assert.match(allowed, /cameraDeviceId/)
  assert.doesNotMatch(allowed, /verificationGrant|customer|qrToken|phone/)
})
