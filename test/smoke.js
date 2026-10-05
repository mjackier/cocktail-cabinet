// Browser smoke test: loads the site in headless Chromium, opens every game, plays each one
// in several side combinations, and fails on any page error. Saves screenshots to test/shots/.
// Usage: node test/smoke.js http://localhost:8080
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const base = process.argv[2] || 'http://localhost:8080';
  const out = path.join(__dirname, 'shots');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) errors.push(m.text()); });

  await page.goto(base + '/', { waitUntil: 'load' });
  await page.screenshot({ path: path.join(out, '00-menu.png') });
  const ids = await page.$$eval('.card', (cs) => cs.map((c) => c.getAttribute('href').slice(1)));
  console.log('games on menu:', ids.join(', '));

  for (const id of ids) {
    await page.goto(base + '/#' + id);
    await page.waitForTimeout(300);
    if (id === 'imitation') {
      await page.click('[data-m="practice"]');
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(out, id + '-matchmaking.png') });
      await page.waitForTimeout(3600);
      // Play a few correct-ish presses with the keyboard.
      for (let i = 0; i < 12; i++) { await page.keyboard.press(['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'][i % 4]); await page.waitForTimeout(250); }
      await page.screenshot({ path: path.join(out, id + '-play.png') });
      await page.click('[data-m="watch"]');
      await page.waitForTimeout(6000);
      await page.screenshot({ path: path.join(out, id + '-watch.png') });
      continue;
    }
    for (const preset of ['classic', 'flip', 'watch']) {
      await page.click(`[data-p="${preset}"]`);
      await page.click('#start');
      // Poke at it like a human: keys, mouse moves, clicks and drags across the canvas.
      const box = await page.locator('#screen').boundingBox();
      for (let i = 0; i < 25; i++) {
        await page.keyboard.press(['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space', 'Digit1', 'Digit3'][i % 7]);
        const x = box.x + box.width * ((i * 37) % 100) / 100, y = box.y + box.height * ((i * 53) % 100) / 100;
        await page.mouse.move(x, y);
        if (i % 3 === 0) { await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8, { steps: 3 }); await page.mouse.up(); }
        await page.waitForTimeout(120);
      }
      const state = await page.evaluate(() => ({ over: window.__cabinet.inst && window.__cabinet.inst.over, stats: window.__cabinet.inst && window.__cabinet.inst.stats && window.__cabinet.inst.stats() }));
      await page.screenshot({ path: path.join(out, `${id}-${preset}.png`) });
      console.log(`${id.padEnd(10)} ${preset.padEnd(8)} ok  ${JSON.stringify(state.stats)}`);
      await page.keyboard.press('KeyP'); await page.keyboard.press('KeyP');
    }
  }
  // Narrow (phone) layout check.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/#snake');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'zz-phone.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) errors.push('horizontal scroll at phone width');

  await browser.close();
  if (errors.length) { console.error('ERRORS:\n' + [...new Set(errors)].join('\n')); process.exit(1); }
  console.log('No page errors.');
})();
