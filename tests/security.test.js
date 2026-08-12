import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

const pages = ['loyalty-join.html', 'loyalty-pass.html', 'loyalty-reset-pin.html']
const unsafeSinks = [/\.innerHTML\s*=/, /\.outerHTML\s*=/, /insertAdjacentHTML\s*\(/, /document\.write\s*\(/, /\beval\s*\(/]

for (const page of pages) {
  test(`${page} avoids unsafe dynamic HTML sinks`, async () => {
    const source = await readFile(new URL(`../${page}`, import.meta.url), 'utf8')
    for (const pattern of unsafeSinks) {
      assert.doesNotMatch(source, pattern)
    }
  })
}

test('dynamic customer data is rendered with textContent', async () => {
  const join = await readFile(new URL('../loyalty-join.html', import.meta.url), 'utf8')
  const pass = await readFile(new URL('../loyalty-pass.html', import.meta.url), 'utf8')
  assert.match(join, /textContent/)
  assert.match(pass, /textContent/)
})

test('OTP generation fails closed and never creates a client-side code', async () => {
  const pass = await readFile(new URL('../loyalty-pass.html', import.meta.url), 'utf8')
  assert.doesNotMatch(pass, /Math\.random\s*\(/)
  assert.match(pass, /!r\.ok/)
  assert.match(pass, /\^\\d\{6\}\$/)
})

test('sensitive URL tokens are removed from browser history', async () => {
  const pass = await readFile(new URL('../loyalty-pass.html', import.meta.url), 'utf8')
  const reset = await readFile(new URL('../loyalty-reset-pin.html', import.meta.url), 'utf8')
  assert.match(pass, /history\.replaceState/)
  assert.match(reset, /params\.delete\('token'\)/)
})

test('saved autofill data expires instead of persisting indefinitely', async () => {
  const join = await readFile(new URL('../loyalty-join.html', import.meta.url), 'utf8')
  assert.match(join, /maxAgeMs/)
  assert.match(join, /savedAt > Date\.now\(\)/)
  assert.match(join, /localStorage\.removeItem\('copo_loyalty_profile'\)/)
  const storedProfile = join.match(/const profile = \{([\s\S]*?)\n\s*\}/)?.[1] || ''
  assert.doesNotMatch(storedProfile, /phone:/)
  assert.doesNotMatch(storedProfile, /email:/)
})

test('merchant logos use a neutral plate and configurable colors get contrasting text', async () => {
  for (const page of pages) {
    const source = await readFile(new URL(`../${page}`, import.meta.url), 'utf8')
    assert.match(source, /--text-on-brand/)
    assert.match(source, /background:\s*#fff/)
  }
  const join = await readFile(new URL('../loyalty-join.html', import.meta.url), 'utf8')
  const pass = await readFile(new URL('../loyalty-pass.html', import.meta.url), 'utf8')
  assert.match(join, /setProperty\('--text-on-brand'/)
  assert.match(pass, /setProperty\('--text-on-brand'/)
})

test('contrast helper chooses accessible text for Copo palette colors', async () => {
  const source = await readFile(new URL('../loyalty-join.html', import.meta.url), 'utf8')
  const start = source.indexOf('function normalizeBrandColor')
  const end = source.indexOf('\n  function applyBranding', start)
  const context = {}
  vm.runInNewContext(source.slice(start, end), context)
  assert.equal(context.getTextOnBrand('#2563EB'), '#FFFFFF')
  assert.equal(context.getTextOnBrand('#16A34A'), '#000000')
  assert.equal(context.getTextOnBrand('#FFFFFF'), '#000000')
  assert.equal(context.getTextOnBrand('#0B132B'), '#FFFFFF')
  assert.equal(context.getTextOnBrand('#777777'), '#000000')
  assert.equal(context.normalizeBrandColor('invalid'), '#2563EB')
})
