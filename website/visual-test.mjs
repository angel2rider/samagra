#!/usr/bin/env node
// Visual test for the CurriculumSelector port.
//
// Strategy: instead of arbitrary mouse drags (which were failing with
// "Invalid parameters" because the upward arc aimed off-screen in headless),
// we click on specific ring items. Clicking an item in a ring snaps it to
// the lens, and the loupe row for that ring must update as a result.
//
// Coordinates: anchor is at (dialRect.x + 8, dialRect.y + dialRect.height/2).

import { chromium } from 'playwright-core'

const URL = 'http://localhost:5173/'
const OUT = '/tmp'

let consoleAll = []
let pageErrors = []

async function readLoupe(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.cs-summary-rows p'))
    return rows.map((p) => (p.textContent ?? '').trim())
  })
}

async function readItemsByRing(page) {
  return page.evaluate(() => {
    const dial = document.querySelector('.cs-dial')
    if (!dial) return null
    const dr = dial.getBoundingClientRect()
    const ax = dr.x + 8
    const ay = dr.y + dr.height / 2
    const buttons = Array.from(dial.querySelectorAll('button'))
    const items = buttons.map((b) => {
      const br = b.getBoundingClientRect()
      return {
        text: (b.textContent ?? '').trim(),
        cx: br.x + br.width / 2,
        cy: br.y + br.height / 2,
        dist: Math.hypot(br.x + br.width / 2 - ax, br.y + br.height / 2 - ay),
      }
    })
    // Sort by distance for reproducible per-ring classifications.
    items.sort((a, b) => a.dist - b.dist)
    return { dialRect: { x: dr.x, y: dr.y, w: dr.width, h: dr.height }, anchor: { ax, ay }, items }
  })
}

async function clickAtIndex(page, ringSelector, idx) {
  // Use element-handle click via DOM; playwright translates to a real mouse click.
  return page.evaluate(({ sel, i }) => {
    const dial = document.querySelector('.cs-dial')
    if (!dial) return false
    const dr = dial.getBoundingClientRect()
    const ax = dr.x + 8
    const ay = dr.y + dr.height / 2
    const buttons = Array.from(dial.querySelectorAll('button'))
    const items = buttons.map((b) => {
      const br = b.getBoundingClientRect()
      return {
        text: (b.textContent ?? '').trim(),
        dist: Math.hypot(br.x + br.width / 2 - ax, br.y + br.height / 2 - ay),
      }
    }).sort((a, b) => a.dist - b.dist)
    // ringSelector examples: 'inner:N', 'middle:N', 'outer:N'
    const [ringKind, _] = sel.split(':')
    let pool
    if (ringKind === 'inner') pool = items.slice(0, 4)
    else if (ringKind === 'middle') pool = items.slice(4, 16)
    else pool = items.slice(16, items.length)
    const target = pool[i]
    if (!target) return false
    const realB = buttons.find((b) => (b.textContent ?? '').trim() === target.text)
    if (!realB) return false
    realB.click()
    return { text: target.text, dist: target.dist }
  }, { sel: ringSelector, i: idx })
}

async function snap(page, path) {
  await page.screenshot({ path: `${OUT}/${path}`, fullPage: false })
}

;(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  page.on('console', (m) => consoleAll.push({ type: m.type(), text: m.text() }))
  page.on('pageerror', (e) => pageErrors.push(`${e.message}\n${e.stack ?? ''}`))

  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.cs-dial', { timeout: 8000 })
    await page.waitForTimeout(6500)

    const items = await readItemsByRing(page)
    const initialLoupe = await readLoupe(page)
    await snap(page, 'samagra-initial.png')

    console.log('===== INITIAL =====')
    console.log(JSON.stringify({
      loupe: initialLoupe,
      itemsByDist: items?.items.slice(0, 8).map((it) => ({ text: it.text, dist: it.dist })),
      itemsCount: items?.items.length,
      consoleErrors: consoleAll.filter((m) => m.type === 'error'),
      pageErrors,
    }, null, 2))

    // ── CLICK inner ring item 1 ("English") — should change loupe[0] ──
    const clickInner = await clickAtIndex(page, 'inner:1', 1)
    await page.waitForTimeout(700) // wait for snap animation
    const afterInnerClick = await readLoupe(page)
    await snap(page, 'samagra-after-lang-drag.png')
    console.log('===== AFTER_INNER_CLICK =====')
    console.log(JSON.stringify({ clicked: clickInner, loupe: afterInnerClick, changed: JSON.stringify(afterInnerClick) !== JSON.stringify(initialLoupe) }, null, 2))

    // ── CLICK middle ring item 2 ("Class 3") ─────────────────────────
    const clickMid = await clickAtIndex(page, 'middle:2', 2)
    await page.waitForTimeout(700)
    const afterMidClick = await readLoupe(page)
    await snap(page, 'samagra-after-class-drag.png')
    console.log('===== AFTER_MIDDLE_CLICK =====')
    console.log(JSON.stringify({ clicked: clickMid, loupe: afterMidClick, changed: JSON.stringify(afterMidClick) !== JSON.stringify(afterInnerClick) }, null, 2))

    // ── CLICK outer ring item 3 ─────────────────────────────────────
    const clickOuter = await clickAtIndex(page, 'outer:3', 3)
    await page.waitForTimeout(700)
    const afterOuterClick = await readLoupe(page)
    await snap(page, 'samagra-after-subject-drag.png')
    console.log('===== AFTER_OUTER_CLICK =====')
    console.log(JSON.stringify({ clicked: clickOuter, loupe: afterOuterClick, changed: JSON.stringify(afterOuterClick) !== JSON.stringify(afterMidClick) }, null, 2))

    // ── PoP verification: a deliberate drag inside the inner ring radius band
    // using the page.mouse coordinate — but bounded within the visible viewport
    // so the upward arc never escapes the page top.
    if (items) {
      const ax = items.anchor.ax
      const ay = items.anchor.ay
      // Drag down-right (positive y) — curl into middle area of the viewport.
      const sx = ax + 78
      const sy = ay
      // arc downward (positive y direction) by ~70 px over 200 ms.
      await page.mouse.move(sx, sy)
      await page.waitForTimeout(40)
      await page.mouse.down()
      await page.waitForTimeout(60)
      const steps = 12
      const arcPx = 60
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        await page.mouse.move(sx + arcPx * t, sy + arcPx * t * 0.6, { steps: 4 })
        await page.waitForTimeout(45)
      }
      await page.mouse.up()
      await page.waitForTimeout(700)
      const afterDrag = await readLoupe(page)
      await snap(page, 'samagra-after-pointer-drag.png')
      console.log('===== AFTER_POINTER_DRAG =====')
      console.log(JSON.stringify({ loupe: afterDrag, changed: JSON.stringify(afterDrag) !== JSON.stringify(afterOuterClick) }, null, 2))
    }

    // ── Search keystrokes ────────────────────────────────────────────
    const searchBox = await page.$('.cs-search-input')
    if (searchBox) {
      await searchBox.click()
      const keystrokes = []
      for (const ch of 'ph') {
        await page.keyboard.type(ch, { delay: 90 })
        await page.waitForTimeout(450)
        const lens = await readLoupe(page)
        await snap(page, `samagra-search-${ch}.png`)
        keystrokes.push({ ch, loupe: lens })
      }
      await page.keyboard.press('Backspace')
      await page.keyboard.press('Backspace')
      await page.waitForTimeout(500)
      await snap(page, 'samagra-search-clear.png')
      console.log('===== SEARCH =====')
      console.log(JSON.stringify(keystrokes, null, 2))
    }

    await snap(page, 'samagra-final.png')

    console.log('===== FINAL =====')
    console.log(JSON.stringify({
      totalConsoleEvents: consoleAll.length,
      errors: consoleAll.filter((m) => m.type === 'error'),
      pageErrors,
    }, null, 2))
  } catch (e) {
    console.log('===== FATAL =====')
    console.log(e.stack ?? e.message)
  } finally {
    await browser.close()
  }
})()
