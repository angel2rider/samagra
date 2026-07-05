import { chromium } from 'playwright-core'

const URL = process.env.URL || 'https://38a9c151.samagra-textbooks.pages.dev'
const outDir = process.env.OUTDIR || '/tmp'

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

  console.log('===== NAVIGATING =====')
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2500)

  const initial = `${outDir}/samagra-initial.png`
  await page.screenshot({ path: initial, fullPage: true })
  console.log('Saved:', initial)

  // Screenshot just the wheel area (viewport crop)
  const dial = page.locator('.cs-dial')
  if (await dial.isVisible().catch(() => false)) {
    const dialBox = await dial.boundingBox()
    if (dialBox) {
      const wheelCrop = `${outDir}/samagra-wheel.png`
      await page.screenshot({
        path: wheelCrop,
        clip: {
          x: Math.max(0, dialBox.x - 20),
          y: Math.max(0, dialBox.y - 20),
          width: dialBox.width + 40,
          height: dialBox.height + 40,
        },
      })
      console.log('Saved:', wheelCrop)
    }
  }

  // Click a visible subject at 3 o'clock (outer ring)
  const subjBtn = page.locator('.cs-anchor button', { hasText: /^(Mathematics|Physics|Chemistry|Biology)$/ }).first()
  if (await subjBtn.isVisible().catch(() => false)) {
    await subjBtn.click({ force: true })
    await page.waitForTimeout(1200)
    const afterSubj = `${outDir}/samagra-after-subject.png`
    await page.screenshot({ path: afterSubj, fullPage: true })
    console.log('Saved:', afterSubj)
  }

  // Click a visible language at 3 o'clock (inner ring)
  const langBtn = page.locator('.cs-anchor button', { hasText: /^(Malayalam|English|Tamil|Kannada)$/ }).first()
  if (await langBtn.isVisible().catch(() => false)) {
    await langBtn.click({ force: true })
    await page.waitForTimeout(1200)
    const afterLang = `${outDir}/samagra-after-language.png`
    await page.screenshot({ path: afterLang, fullPage: true })
    console.log('Saved:', afterLang)
  }

  // Mobile viewport screenshot
  await page.setViewportSize({ width: 480, height: 900 })
  await page.waitForTimeout(800)
  const mobile = `${outDir}/samagra-mobile.png`
  await page.screenshot({ path: mobile, fullPage: true })
  console.log('Saved:', mobile)

  await browser.close()
  console.log('===== DONE =====')
}

main().catch((e) => {
  console.error('FATAL', e.message)
  process.exit(1)
})
