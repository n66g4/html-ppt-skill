#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

function requirePlaywright() {
  try {
    return require('playwright');
  } catch (err) {
    const bundled = process.env.CODEX_BUNDLED_NODE_MODULES ||
      'C:\\Users\\windx\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules';
    const pnpmDir = path.join(bundled, '.pnpm');
    if (!fs.existsSync(pnpmDir)) throw err;
    const entry = fs.readdirSync(pnpmDir).find(name => /^playwright@\d/.test(name));
    if (!entry) throw err;
    return require(path.join(pnpmDir, entry, 'node_modules', 'playwright'));
  }
}

const { chromium } = requirePlaywright();
const root = path.resolve(__dirname, '..');
const runtimeUrl = pathToFileURL(path.join(root, 'assets', 'runtime.js')).href;
const baseUrl = pathToFileURL(path.join(root, 'assets', 'base.css')).href;
const themeUrl = pathToFileURL(path.join(root, 'assets', 'themes', 'corporate-clean.css')).href;
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'html-ppt-presenter-test-'));
  const htmlPath = path.join(tmp, 'index.html');
  fs.writeFileSync(htmlPath, `<!doctype html>
<html lang="zh-CN" data-theme="corporate-clean" data-themes="corporate-clean,minimal-white" data-theme-base="${pathToFileURL(path.join(root, 'assets', 'themes')).href}/">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="${baseUrl}">
  <link rel="stylesheet" id="theme-link" href="${themeUrl}">
  <style>.slide { padding: 80px 100px; }</style>
</head>
<body>
<div class="deck">
  <section class="slide" data-title="封面" data-slide-id="cover">
    <h1 class="h1">第一页</h1>
    <svg width="10" height="10"><defs><linearGradient id="g1"></linearGradient></defs><rect fill="url(#g1)" width="10" height="10"/></svg>
    <aside class="notes"><p>第一页备注</p></aside>
  </section>
  <section class="slide" data-title="第二页" data-slide-id="slide-02">
    <h1 class="h1">第二页</h1>
    <aside class="notes"><p>第二页备注</p></aside>
  </section>
  <section class="slide" data-title="第三页" data-slide-id="slide-03">
    <h1 class="h1">第三页</h1>
    <figure class="frame-img"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='180'%3E%3Crect width='100%25' height='100%25' fill='%2384a8ff'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='white' font-size='24'%3EZoom%3C/text%3E%3C/svg%3E" alt="zoom test"></figure>
    <aside class="notes"><p>第三页备注</p></aside>
  </section>
</div>
<script>
window.__SPEAKER_NOTES__ = [
  { id: 'cover', title: '封面页', section: '开场', minutes: 1, purpose: '建立主题', talk: ['问候观众', '说明议程'], transition: '进入第二页' },
  { id: 'slide-02', title: '第二页', section: '主体', purpose: '展开论点', talk: ['要点 A'], transition: '' }
];
</script>
<script src="${runtimeUrl}"></script>
</body>
</html>`, 'utf8');

  const deckUrl = pathToFileURL(htmlPath).href;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto(deckUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('#html-ppt-presenter-hint');

  const chromeLabels = await page.evaluate(() => ({
    overview: Array.from(document.querySelectorAll('.overview-label'), el => el.textContent),
    pageNav: Array.from(document.querySelectorAll('.page-nav-label'), el => el.textContent)
  }));
  assert(chromeLabels.overview.length === 3 && chromeLabels.overview.every(t => t && t.trim()),
    'overview cards should show slide titles, got ' + JSON.stringify(chromeLabels.overview));
  assert(chromeLabels.pageNav.length === 3 && chromeLabels.pageNav.every(t => t && t.trim()),
    'page navigator items should show slide titles, got ' + JSON.stringify(chromeLabels.pageNav));

  const cloneIds = await page.evaluate(() => Array.from(document.querySelectorAll('linearGradient'), el => el.id));
  assert(cloneIds.length === 3 && new Set(cloneIds).size === 3,
    'overview and page-nav clones must not share svg ids, got ' + JSON.stringify(cloneIds));

  let previewRequestCount = 0;
  page.on('request', req => {
    if (/[?&]preview=\d+/.test(req.url())) previewRequestCount++;
  });

  await page.keyboard.press('s');
  await page.waitForTimeout(200);
  const sEntered = await page.evaluate(() => document.body.classList.contains('html-ppt-presenter-active'));
  assert(!sEntered, 'S should not enter presenter mode (use P only)');

  await page.keyboard.press('p');
  await page.waitForSelector('#html-ppt-presenter', { state: 'visible' });
  await page.waitForTimeout(2800);
  const reloadsWhileIdle = previewRequestCount;
  assert(reloadsWhileIdle <= 3, 'preview iframes should not keep reloading while idle, got ' + reloadsWhileIdle + ' requests');
  previewRequestCount = 0;

  const active = await page.evaluate(() => document.body.classList.contains('html-ppt-presenter-active'));
  assert(active, 'body should have html-ppt-presenter-active after P');

  const notesTitle = await page.locator('[data-role="notes-title"]').innerText();
  assert(notesTitle.includes('封面页'), 'structured SPEAKER_NOTES title should render');

  const purpose = await page.locator('[data-role="notes-purpose"]').innerText();
  assert(purpose.includes('建立主题'), 'structured purpose should render');

  const draftInitial = await page.locator('.hpp-note-editor').inputValue();
  assert(draftInitial.includes('问候观众'), 'draft should prefill from SPEAKER_NOTES talk points');
  assert(draftInitial.includes('进入第二页'), 'draft should prefill transition from SPEAKER_NOTES');

  await page.locator('.hpp-note-editor').fill('第一页草稿修改');
  await page.locator('[data-action="next"]').click();
  await page.waitForTimeout(150);
  await page.locator('[data-action="prev"]').click();
  await page.waitForTimeout(150);
  let draftAfterNav = await page.locator('.hpp-note-editor').inputValue();
  assert(draftAfterNav === '第一页草稿修改', 'draft should persist after slide navigation (flush on leave)');

  await page.locator('.hpp-note-editor').fill('快速保存测试');
  await page.locator('[data-action="next"]').click();
  await page.locator('[data-action="prev"]').click();
  draftAfterNav = await page.locator('.hpp-note-editor').inputValue();
  assert(draftAfterNav === '快速保存测试', 'draft should persist even without debounce wait');

  const audiencePage = await context.newPage();
  await audiencePage.goto(deckUrl + '?audience=1', { waitUntil: 'networkidle' });

  await audiencePage.evaluate(() => {
    window.__slideClassChanges = 0;
    document.querySelectorAll('.deck > .slide').forEach(slide => {
      new MutationObserver(() => { window.__slideClassChanges++; })
        .observe(slide, { attributes: true, attributeFilter: ['class'] });
    });
  });

  await page.locator('[data-action="next"]').click();
  await page.waitForTimeout(400);
  assert(previewRequestCount <= 2, 'slide change should use postMessage not full reload, got ' + previewRequestCount + ' preview requests');
  previewRequestCount = 0;

  const audienceSlide = await audiencePage.evaluate(() => {
    const slides = Array.from(document.querySelectorAll('.slide'));
    return slides.findIndex(s => s.classList.contains('is-active'));
  });
  assert(audienceSlide === 1, 'audience window should sync to slide 2, got ' + audienceSlide);
  const classChanges = await audiencePage.evaluate(() => window.__slideClassChanges);
  assert(classChanges <= 4, 'audience should apply one go per navigation, got ' + classChanges + ' class changes');

  const notes2 = await page.locator('[data-role="notes-title"]').innerText();
  assert(notes2.includes('第二页'), 'presenter notes should update on navigation');

  await page.locator('[data-action="freeze"]').click();
  await page.waitForTimeout(100);
  await page.locator('[data-action="next"]').click();
  await page.waitForTimeout(200);
  const frozenSlide = await audiencePage.evaluate(() =>
    Array.from(document.querySelectorAll('.deck > .slide')).findIndex(s => s.classList.contains('is-active')));
  assert(frozenSlide === 1, 'frozen audience should stay on slide 2, got ' + frozenSlide);
  await page.locator('[data-action="freeze"]').click();
  await page.waitForTimeout(200);
  const thawedSlide = await audiencePage.evaluate(() =>
    Array.from(document.querySelectorAll('.deck > .slide')).findIndex(s => s.classList.contains('is-active')));
  assert(thawedSlide === 2, 'unfreeze should catch the audience up, got ' + thawedSlide);

  await page.keyboard.press('g');
  await page.waitForSelector('.hpp-overview:not([hidden])');
  await page.locator('.hpp-overview-page').nth(2).click();
  await page.waitForTimeout(200);
  const idxAfterGrid = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.slide')).findIndex(s => s.classList.contains('is-active'));
  });
  assert(idxAfterGrid === 2, 'grid click should jump to slide 3, got ' + idxAfterGrid);

  await page.locator('[data-action="screen-black"]').click();
  await page.waitForTimeout(200);
  const audienceBlack = await audiencePage.evaluate(() => {
    const cover = document.getElementById('html-ppt-audience-cover');
    return cover && cover.style.display !== 'none' && cover.style.background.includes('0, 0, 0');
  });
  assert(audienceBlack, 'black screen should sync to audience window');

  const blackBtnOn = await page.locator('[data-action="screen-black"]').evaluate(el =>
    el.classList.contains('is-on'));
  assert(blackBtnOn, 'black screen button should show active state');

  await page.keyboard.press('b');
  await page.waitForTimeout(200);
  const audienceBlackCleared = await audiencePage.evaluate(() => {
    const cover = document.getElementById('html-ppt-audience-cover');
    return !cover || cover.style.display === 'none';
  });
  assert(audienceBlackCleared, 'pressing B twice should restore the audience screen');

  await page.locator('[data-action="freeze"]').click();
  await page.waitForTimeout(150);
  const freezeOn = await page.locator('[data-action="freeze"]').evaluate(el =>
    el.classList.contains('is-on'));
  assert(freezeOn, 'freeze button should show active state');
  await page.locator('[data-action="freeze"]').click();
  await page.waitForTimeout(150);

  await page.evaluate(() => {
    const bc = new BroadcastChannel('html-ppt-presenter-' + location.pathname);
    bc.postMessage({ type: 'laser', point: { x: 0.5, y: 0.5 } });
  });
  await page.waitForTimeout(150);
  const laserVisible = await audiencePage.evaluate(() => {
    const c = document.getElementById('html-ppt-audience-ink');
    if (!c) return false;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
    return false;
  });
  assert(laserVisible, 'laser point should render on audience window');
  await page.waitForTimeout(900);
  const laserFaded = await audiencePage.evaluate(() => {
    const c = document.getElementById('html-ppt-audience-ink');
    if (!c) return true;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return false;
    return true;
  });
  assert(laserFaded, 'laser point should fade out on audience when pointer stops');

  await page.waitForTimeout(150);

  await page.waitForFunction(() => {
    const frames = Array.from(document.querySelectorAll('#html-ppt-presenter iframe'));
    return frames.some(f => /preview=/.test(f.src || ''));
  }, { timeout: 10000 });
  const previewFrame = page.frameLocator('#html-ppt-presenter iframe[src*="preview="]').first();
  await previewFrame.locator('.slide.is-active img').waitFor({ timeout: 10000 });
  await previewFrame.locator('.slide.is-active img').click({ force: true });
  await page.waitForTimeout(300);
  const audienceZoomVisible = await audiencePage.evaluate(() => {
    const el = document.getElementById('html-ppt-audience-image-focus');
    return !!(el && el.style.display === 'flex' && el.querySelector('img')?.src);
  });
  assert(audienceZoomVisible, 'clicking image in presenter preview should zoom on audience screen');

  await audiencePage.bringToFront();
  await audiencePage.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const audienceEscCleared = await audiencePage.evaluate(() => {
    const el = document.getElementById('html-ppt-audience-image-focus');
    return !el || el.style.display === 'none';
  });
  assert(audienceEscCleared, 'Esc on audience window should clear image zoom');

  await page.bringToFront();
  await previewFrame.locator('.slide.is-active img').click({ force: true });
  await page.waitForTimeout(250);
  const rezoomed = await audiencePage.evaluate(() => {
    const el = document.getElementById('html-ppt-audience-image-focus');
    return !!(el && el.style.display === 'flex');
  });
  assert(rezoomed, 'after audience Esc, presenter can zoom the same image again');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const audienceZoomCleared = await audiencePage.evaluate(() => {
    const el = document.getElementById('html-ppt-audience-image-focus');
    return !el || el.style.display === 'none';
  });
  assert(audienceZoomCleared, 'Esc on presenter should clear audience image zoom');

  await audiencePage.locator('.slide.is-active img').click({ force: true });
  await page.waitForTimeout(150);
  const noLocalLightbox = await audiencePage.evaluate(() => {
    const el = document.getElementById('html-ppt-audience-image-focus');
    return !el || el.style.display === 'none';
  });
  assert(noLocalLightbox, 'clicking an image on the audience window must not open a local zoom overlay');

  await page.keyboard.press('v');
  await page.waitForTimeout(200);
  const editorDuringPresenter = await page.evaluate(() =>
    document.body.classList.contains('html-ppt-editor-active'));
  assert(!editorDuringPresenter, 'V should not enter editor during presenter mode');

  await page.locator('.hpp-note-editor').click();
  await page.keyboard.type('test');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  const idxWhileTyping = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.slide')).findIndex(s => s.classList.contains('is-active')));
  assert(idxWhileTyping === 2, 'ArrowRight in note editor should not change slide');

  await page.locator('[data-action="prev"]').click();
  await page.waitForTimeout(150);
  await page.keyboard.press('o');
  await page.waitForSelector('.hpp-overview:not([hidden])');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const overviewClosed = await page.locator('.hpp-overview').isHidden();
  assert(overviewClosed, 'Esc should close overview before exiting presenter');

  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const idxAfterEnter = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.slide')).findIndex(s => s.classList.contains('is-active')));
  assert(idxAfterEnter === 2, 'Enter should navigate to next slide in presenter mode');

  const themeBefore = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.keyboard.press('t');
  await page.waitForTimeout(200);
  const themeAfter = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  assert(themeBefore !== themeAfter, 'T should cycle theme in presenter mode');
  const audienceTheme = await audiencePage.evaluate(() => document.documentElement.getAttribute('data-theme'));
  assert(audienceTheme === themeAfter, 'T in presenter should sync theme to audience window');

  const idxNow = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.slide')).findIndex(s => s.classList.contains('is-active')));
  await audiencePage.reload({ waitUntil: 'networkidle' });
  await audiencePage.waitForFunction(
    expected => Array.from(document.querySelectorAll('.slide')).findIndex(s => s.classList.contains('is-active')) === expected,
    idxNow,
    { timeout: 5000 }
  );
  const rejoinedTheme = await audiencePage.evaluate(() => document.documentElement.getAttribute('data-theme'));
  assert(rejoinedTheme === themeAfter,
    'reloaded audience window should rejoin with the presenter theme, got ' + rejoinedTheme);

  /* Circles must be normalized against the 16:9 slide, not the letterboxed
   * viewport, otherwise they land off-target on the audience screen. */
  await page.evaluate(() => {
    window.__sentCircles = [];
    const bc = new BroadcastChannel('html-ppt-presenter-' + location.pathname);
    bc.onmessage = e => {
      if (e.data && e.data.type === 'circles') window.__sentCircles.push(e.data.circles);
    };
  });
  const slideRect = await page.evaluate(() => {
    const frame = document.querySelector('.hpp-preview-stack .hpp-stage-card:first-child .hpp-frame');
    const r = frame.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.keyboard.press('c');
  const cx = slideRect.x + slideRect.w / 2;
  const cy = slideRect.y + slideRect.h / 2;
  const dx = slideRect.w * 0.1;
  const dy = slideRect.h * 0.1;
  await page.mouse.move(cx - dx, cy - dy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const drawn = await page.evaluate(() => {
    const batches = window.__sentCircles || [];
    const last = batches[batches.length - 1];
    return last && last.length ? last[last.length - 1] : null;
  });
  assert(drawn, 'dragging with the circle tool should broadcast a circle');
  const near = (value, expected) => Math.abs(value - expected) < 0.01;
  assert(near((drawn.x1 + drawn.x2) / 2, 0.5) && near((drawn.y1 + drawn.y2) / 2, 0.5),
    'circle centered on the slide should normalize to 0.5/0.5, got ' +
    ((drawn.x1 + drawn.x2) / 2).toFixed(3) + '/' + ((drawn.y1 + drawn.y2) / 2).toFixed(3));
  assert(near(Math.abs(drawn.x2 - drawn.x1) / 2, 0.1) && near(Math.abs(drawn.y2 - drawn.y1) / 2, 0.1),
    'circle size should normalize against the slide box, got ' +
    (Math.abs(drawn.x2 - drawn.x1) / 2).toFixed(3) + '/' + (Math.abs(drawn.y2 - drawn.y1) / 2).toFixed(3));
  await page.keyboard.press('x');
  await page.keyboard.press('c');
  await page.waitForTimeout(150);

  await page.evaluate(() => {
    const bc = new BroadcastChannel('html-ppt-presenter-' + location.pathname);
    bc.postMessage({ type: 'circles', circles: [{ x1: 0.2, y1: 0.2, x2: 0.4, y2: 0.4 }] });
  });
  await page.waitForTimeout(200);
  const inkBeforeNav = await audiencePage.evaluate(() => {
    const c = document.getElementById('html-ppt-audience-ink');
    if (!c) return false;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
    return false;
  });
  assert(inkBeforeNav, 'test circles should render on audience ink layer');
  await page.locator('[data-action="prev"]').click();
  await page.waitForTimeout(300);
  const inkAfterNav = await audiencePage.evaluate(() => {
    const c = document.getElementById('html-ppt-audience-ink');
    if (!c) return false;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
    return false;
  });
  assert(!inkAfterNav, 'slide navigation should clear audience annotations');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.body.classList.contains('html-ppt-presenter-active'));

  const exited = await page.evaluate(() => !document.body.classList.contains('html-ppt-presenter-active'));
  assert(exited, 'Esc should exit presenter mode');

  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('test-presenter-mode: all checks passed');
}

main().catch(err => {
  console.error('test-presenter-mode FAILED:', err.message);
  process.exit(1);
});
