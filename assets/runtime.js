/* html-ppt-skill :: runtime.js
 * Keyboard-driven deck runtime. Zero dependencies.
 *
 * Features:
 *   ← → / space / PgUp PgDn / Home End  navigation
 *   F  fullscreen
 *   P  presenter mode (in-page overlay + separate audience window via ?audience=1)
 *       Dual 16:9 iframe previews, notes panel, timer; synced via BroadcastChannel.
 *   N  quick notes overlay (bottom drawer)
 *   O  slide overview grid
 *   E  page navigator with slide thumbnails
 *   T  cycle themes (reads data-themes on <html> or <body>)
 *   URL hash #/N  deep-link to slide N (1-based)
 *   Progress bar auto-managed
 */
(function () {
  'use strict';

  const runtimeScript = document.currentScript;

  function ready(fn){ if(document.readyState!='loading')fn(); else document.addEventListener('DOMContentLoaded',fn);}

  function loadDeckEditorAssets() {
    if (window.HtmlPptDeckEditor || window.__htmlPptDeckEditorLoading) return;
    if (getPreviewIdx() >= 0 || getQueryParam('audience') === '1') return;
    if (window.matchMedia && window.matchMedia('print').matches) return;

    const src = runtimeScript && runtimeScript.getAttribute('src');
    const base = src && src.indexOf('/') >= 0 ? src.slice(0, src.lastIndexOf('/') + 1) : 'assets/';
    window.__htmlPptDeckEditorLoading = true;

    if (!document.querySelector('link[data-html-ppt-editor-asset="css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = base + 'editor.css';
      link.setAttribute('data-html-ppt-editor-asset', 'css');
      document.head.appendChild(link);
    }

    if (!document.querySelector('script[data-html-ppt-editor-asset="js"]')) {
      const script = document.createElement('script');
      script.src = base + 'editor.js';
      script.defer = true;
      script.setAttribute('data-html-ppt-editor-asset', 'js');
      script.addEventListener('error', () => { window.__htmlPptDeckEditorLoading = false; });
      document.head.appendChild(script);
    }
  }

  /* ========== Parse URL for preview-only mode ==========
   * When loaded as iframe.src = "index.html?preview=3", runtime enters a
   * locked single-slide mode: only slide N is visible, no chrome, no keys,
   * no hash updates. This is how the presenter window shows pixel-perfect
   * previews — by loading the actual deck file in an iframe and telling it
   * to display only a specific slide.
   */
  function getPreviewIdx() {
    const m = /[?&]preview=(\d+)/.exec(location.search || '');
    return m ? parseInt(m[1], 10) - 1 : -1;
  }
  function getQueryParam(name) {
    try { return new URLSearchParams(location.search || '').get(name); }
    catch(e) { return null; }
  }
  function getRuntimeAssetBase() {
    const src = runtimeScript && runtimeScript.getAttribute('src');
    return src && src.indexOf('/') >= 0 ? src.slice(0, src.lastIndexOf('/') + 1) : 'assets/';
  }
  function loadPresenterAssets(onReady) {
    if (window.HtmlPptPresenter) {
      if (onReady) onReady();
      return;
    }
    if (window.__htmlPptPresenterLoading) {
      if (onReady) document.addEventListener('html-ppt-presenter-ready', onReady, { once: true });
      return;
    }
    window.__htmlPptPresenterLoading = true;
    const base = getRuntimeAssetBase();
    if (!document.querySelector('link[data-html-ppt-presenter-asset="css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = base + 'presenter.css';
      link.setAttribute('data-html-ppt-presenter-asset', 'css');
      document.head.appendChild(link);
    }
    if (!document.querySelector('script[data-html-ppt-presenter-asset="js"]')) {
      const script = document.createElement('script');
      script.src = base + 'presenter.js';
      script.defer = true;
      script.setAttribute('data-html-ppt-presenter-asset', 'js');
      script.addEventListener('load', () => {
        window.__htmlPptPresenterLoading = false;
        document.dispatchEvent(new Event('html-ppt-presenter-ready'));
        if (onReady) onReady();
      });
      script.addEventListener('error', () => { window.__htmlPptPresenterLoading = false; });
      document.head.appendChild(script);
    } else if (onReady) {
      document.addEventListener('html-ppt-presenter-ready', onReady, { once: true });
    }
  }
  function getDeckBaseUrl() {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    return url.href;
  }
  function getCounterConfig(el) {
    const targetRaw = String(el.getAttribute('data-to') || el.textContent || '').replace(/,/g, '');
    const target = parseFloat(targetRaw);
    if (!Number.isFinite(target)) return null;
    const fromRaw = String(el.getAttribute('data-from') || '0').replace(/,/g, '');
    const from = Number.isFinite(parseFloat(fromRaw)) ? parseFloat(fromRaw) : 0;
    const text = String(el.textContent || '').trim();
    const match = text.match(/^([^0-9+\-.,]*)([-+]?\d[\d,]*(?:\.\d+)?)(.*)$/);
    const prefix = el.getAttribute('data-prefix') ?? (match ? match[1] : '');
    const suffix = el.getAttribute('data-suffix') ?? (match ? match[3] : '');
    const decimalsAttr = el.getAttribute('data-decimals');
    const decimalMatch = targetRaw.match(/\.(\d+)/);
    const decimals = decimalsAttr !== null
      ? Math.max(0, Math.min(6, parseInt(decimalsAttr, 10) || 0))
      : (decimalMatch ? Math.min(6, decimalMatch[1].length) : 0);
    const dur = Math.max(0, parseInt(el.getAttribute('data-dur') || '1200', 10) || 1200);
    return { target, from, prefix, suffix, decimals, dur };
  }
  function formatCounterValue(value, cfg) {
    const number = cfg.decimals > 0 ? value.toFixed(cfg.decimals) : String(Math.round(value));
    return cfg.prefix + number + cfg.suffix;
  }
  function setCounterValue(el, value, cfg) {
    const conf = cfg || getCounterConfig(el);
    if (!conf) return;
    el.textContent = formatCounterValue(value, conf);
  }
  function finalizeCounters(root) {
    root.querySelectorAll('.counter').forEach(el => {
      const cfg = getCounterConfig(el);
      if (cfg) setCounterValue(el, cfg.target, cfg);
    });
  }
  function animateCounters(root) {
    root.querySelectorAll('.counter').forEach(el => {
      const cfg = getCounterConfig(el);
      if (!cfg) return;
      const runId = String((parseInt(el.getAttribute('data-counter-run') || '0', 10) || 0) + 1);
      el.setAttribute('data-counter-run', runId);
      const start = performance.now();
      setCounterValue(el, cfg.from, cfg);
      function tick(now) {
        if (el.getAttribute('data-counter-run') !== runId) return;
        const t = cfg.dur === 0 ? 1 : Math.min(1, (now - start) / cfg.dur);
        const eased = 1 - Math.pow(1 - t, 3);
        const value = cfg.from + (cfg.target - cfg.from) * eased;
        setCounterValue(el, value, cfg);
        if (t < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }
  ready(function () {
    const deck = document.querySelector('.deck');
    if (!deck) return;
    const slides = Array.from(deck.querySelectorAll('.slide'));
    if (!slides.length) return;
    const total = slides.length;
    const CHANNEL_NAME = 'html-ppt-presenter-' + location.pathname;

    const previewOnlyIdx = getPreviewIdx();
    const isPreviewMode = previewOnlyIdx >= 0 && previewOnlyIdx < slides.length;

    /* ===== Preview-only mode: show one slide, hide everything else ===== */
    if (isPreviewMode) {
      function showSlide(i) {
        slides.forEach((s, j) => {
          const active = (j === i);
          s.classList.toggle('is-active', active);
          s.style.display = active ? '' : 'none';
          if (active) {
            s.style.opacity = '1';
            s.style.transform = 'none';
            s.style.pointerEvents = 'auto';
          }
        });
        slides[i].querySelectorAll('[data-anim]').forEach(el => {
          const a = el.getAttribute('data-anim');
          el.classList.remove('anim-' + a);
          void el.offsetWidth;
          el.classList.add('anim-' + a);
        });
        /* Previews show final counter values rather than counting up, so the
         * presenter always reads the real number. */
        finalizeCounters(slides[i]);
      }
      showSlide(previewOnlyIdx);
      /* Hide chrome that the presenter shouldn't see in preview */
      const hideSel = '.progress-bar, .notes-overlay, .overview, .notes, aside.notes, .speaker-notes';
      document.querySelectorAll(hideSel).forEach(el => { el.style.display = 'none'; });
      document.documentElement.setAttribute('data-preview', '1');
      document.body.setAttribute('data-preview', '1');
      /* Auto-detect theme base path for theme switching in preview mode */
      function getPreviewThemeBase() {
        const base = document.documentElement.getAttribute('data-theme-base');
        if (base) return base;
        const tl = document.getElementById('theme-link');
        if (tl) {
          const raw = tl.getAttribute('href') || '';
          const ls = raw.lastIndexOf('/');
          if (ls >= 0) return raw.substring(0, ls + 1);
        }
        return 'assets/themes/';
      }
      const previewThemeBase = getPreviewThemeBase();

      /* Listen for postMessage from parent presenter window:
       *  - preview-goto: switch visible slide WITHOUT reloading
       *  - preview-theme: switch theme CSS link to match audience window */
      window.addEventListener('message', function(e) {
        if (!e.data) return;
        if (e.data.type === 'preview-goto') {
          const n = parseInt(e.data.idx, 10);
          if (n >= 0 && n < slides.length) showSlide(n);
        } else if (e.data.type === 'preview-theme' && e.data.name) {
          let link = document.getElementById('theme-link');
          if (!link) {
            link = document.createElement('link');
            link.rel = 'stylesheet';
            link.id = 'theme-link';
            document.head.appendChild(link);
          }
          link.href = previewThemeBase + e.data.name + '.css';
          document.documentElement.setAttribute('data-theme', e.data.name);
        }
      });
      function isZoomableImage(img) {
        if (!img || img.tagName !== 'IMG') return false;
        if (img.closest('.notes, aside.notes, .speaker-notes')) return false;
        if (img.hasAttribute('data-no-zoom')) return false;
        return true;
      }
      document.addEventListener('click', function (e) {
        const img = e.target && e.target.closest ? e.target.closest('img') : null;
        if (!isZoomableImage(img)) return;
        const slide = img.closest('.slide');
        if (!slide || !slide.classList.contains('is-active')) return;
        e.preventDefault();
        e.stopPropagation();
        try {
          window.parent.postMessage({
            type: 'preview-image-click',
            src: img.currentSrc || img.src,
            alt: img.alt || ''
          }, '*');
        } catch (err) { /* ignore */ }
      }, true);
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        try {
          window.parent.postMessage({ type: 'preview-key', key: 'Escape' }, '*');
        } catch (err) { /* ignore */ }
      }, true);

      /* Signal to parent that preview iframe is ready */
      try { window.parent && window.parent.postMessage({ type: 'preview-ready' }, '*'); } catch(e) {}
      return;
    }

    /* ===== Audience window (?audience=1) — synced slide view for projector ===== */
    if (getQueryParam('audience') === '1') {
      let audienceIdx = 0;
      const rawSlide = parseInt(getQueryParam('slide') || '1', 10);
      if (Number.isFinite(rawSlide) && rawSlide > 0) {
        audienceIdx = Math.max(0, Math.min(total - 1, rawSlide - 1));
      }
      document.documentElement.setAttribute('data-audience', '1');
      document.body.setAttribute('data-audience', '1');
      document.querySelectorAll('.progress-bar, .notes-overlay, .overview, .page-navigator, .page-nav-hotspot, .notes, aside.notes, .speaker-notes').forEach(el => {
        el.style.display = 'none';
      });

      let audienceBc;
      try { audienceBc = new BroadcastChannel(CHANNEL_NAME); } catch(e) { audienceBc = null; }

      const audienceRoot = document.documentElement;
      let audienceThemeBase = audienceRoot.getAttribute('data-theme-base');
      if (!audienceThemeBase) {
        const existingLink = document.getElementById('theme-link');
        if (existingLink) {
          const rawHref = existingLink.getAttribute('href') || '';
          const lastSlash = rawHref.lastIndexOf('/');
          audienceThemeBase = lastSlash >= 0 ? rawHref.substring(0, lastSlash + 1) : 'assets/themes/';
        } else {
          audienceThemeBase = 'assets/themes/';
        }
      }
      function audienceApplyTheme(name) {
        name = String(name || '').trim().replace(/\.css$/i, '');
        if (!name) return;
        let link = document.getElementById('theme-link');
        if (!link) {
          link = document.createElement('link');
          link.rel = 'stylesheet';
          link.id = 'theme-link';
          document.head.appendChild(link);
        }
        link.href = audienceThemeBase + name + '.css';
        audienceRoot.setAttribute('data-theme', name);
      }

      function audienceGo(n) {
        n = Math.max(0, Math.min(total - 1, n));
        if (audienceNavReady && n === audienceIdx && slides[n].classList.contains('is-active')) return;
        slides.forEach((s, i) => {
          s.classList.toggle('is-active', i === n);
          s.classList.toggle('is-prev', i < n);
        });
        audienceIdx = n;
        audienceNavReady = true;
        slides[n].querySelectorAll('[data-anim]').forEach(el => {
          const a = el.getAttribute('data-anim');
          el.classList.remove('anim-' + a);
          void el.offsetWidth;
          el.classList.add('anim-' + a);
        });
        animateCounters(slides[n]);
      }

      let audienceFrozen = false;
      let audiencePendingIdx = null;
      let audienceNavReady = false;
      let audienceScreenMode = 'normal';
      let audienceLaser = null;
      let audienceLaserHideAt = 0;
      let audienceLaserTimer = null;
      let audienceCircles = [];
      let audienceImageFocusEl = null;

      function ensureAudienceImageFocus() {
        if (audienceImageFocusEl) return audienceImageFocusEl;
        const el = document.createElement('div');
        el.id = 'html-ppt-audience-image-focus';
        /* pointer-events:auto so clicks hit the overlay (dismiss) instead of
         * falling through to the slide — and so Esc/focus stay meaningful. */
        el.style.cssText = 'position:fixed;inset:0;z-index:10001;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.88);padding:24px;box-sizing:border-box;cursor:zoom-out';
        const img = document.createElement('img');
        img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;display:block;pointer-events:none';
        img.alt = '';
        el.appendChild(img);
        el.addEventListener('click', () => dismissAudienceImageFocus());
        document.body.appendChild(el);
        audienceImageFocusEl = el;
        return el;
      }

      function setAudienceImageFocus(data) {
        if (!data || !data.src) {
          clearAudienceImageFocus();
          return;
        }
        const el = ensureAudienceImageFocus();
        const img = el.querySelector('img');
        img.src = data.src;
        img.alt = data.alt || '';
        el.style.display = 'flex';
      }

      function clearAudienceImageFocus() {
        if (!audienceImageFocusEl) return;
        audienceImageFocusEl.style.display = 'none';
        const img = audienceImageFocusEl.querySelector('img');
        if (img) {
          img.removeAttribute('src');
          img.alt = '';
        }
      }

      function isAudienceImageFocused() {
        return !!(audienceImageFocusEl && audienceImageFocusEl.style.display === 'flex');
      }

      /* Local dismiss (Esc / click) must also tell the presenter to drop its
       * imageFocusSrc, or the next same-image click would only toggle-off and
       * the projector would stay stuck if focus never returns to presenter. */
      function dismissAudienceImageFocus() {
        if (!isAudienceImageFocused()) return;
        clearAudienceImageFocus();
        if (audienceBc) {
          try { audienceBc.postMessage({ type: 'image-focus-clear' }); } catch(e) { /* ignore */ }
        }
      }

      /* Audience is a projection surface: never open a local image lightbox from
       * a click here. Only the presenter may raise image-focus over the channel. */
      document.addEventListener('click', function (e) {
        const img = e.target && e.target.closest ? e.target.closest('img') : null;
        if (!img || img.closest('#html-ppt-audience-image-focus')) return;
        if (img.closest('.notes, aside.notes, .speaker-notes')) return;
        e.preventDefault();
        e.stopPropagation();
      }, true);

      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (!isAudienceImageFocused()) return;
        e.preventDefault();
        dismissAudienceImageFocus();
      });

      function ensureAudienceCover() {
        let cover = document.getElementById('html-ppt-audience-cover');
        if (!cover) {
          cover = document.createElement('div');
          cover.id = 'html-ppt-audience-cover';
          /* Must sit above the image-zoom overlay so B / W really blank the screen. */
          cover.style.cssText = 'position:fixed;inset:0;z-index:10020;display:none;pointer-events:none';
          document.body.appendChild(cover);
        }
        return cover;
      }
      function ensureAudienceInk() {
        let ink = document.getElementById('html-ppt-audience-ink');
        if (!ink) {
          ink = document.createElement('canvas');
          ink.id = 'html-ppt-audience-ink';
          ink.style.cssText = 'position:fixed;inset:0;z-index:9998;width:100vw;height:100vh;pointer-events:none';
          document.body.appendChild(ink);
        }
        return ink;
      }
      function drawAudienceInk() {
        const canvas = ensureAudienceInk();
        const ctx = canvas.getContext('2d');
        const w = canvas.width = window.innerWidth;
        const h = canvas.height = window.innerHeight;
        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = '#ff5b63';
        ctx.lineWidth = Math.max(2, w * 0.003);
        audienceCircles.forEach(c => {
          const x = ((c.x1 + c.x2) / 2) * w;
          const y = ((c.y1 + c.y2) / 2) * h;
          const rx = Math.abs(c.x2 - c.x1) * w / 2;
          const ry = Math.abs(c.y2 - c.y1) * h / 2;
          ctx.beginPath();
          ctx.ellipse(x, y, Math.max(8, rx), Math.max(8, ry), 0, 0, Math.PI * 2);
          ctx.stroke();
        });
        const now = Date.now();
        if (audienceLaser && now < audienceLaserHideAt) {
          const x = audienceLaser.x * w;
          const y = audienceLaser.y * h;
          const r = Math.max(6, w * 0.007);
          const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
          g.addColorStop(0, 'rgba(255,91,99,.95)');
          g.addColorStop(1, 'rgba(255,91,99,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, r * 3, 0, Math.PI * 2);
          ctx.fill();
        } else {
          audienceLaser = null;
        }
      }
      function setAudienceScreen(mode) {
        audienceScreenMode = mode || 'normal';
        const cover = ensureAudienceCover();
        if (audienceScreenMode === 'black') {
          cover.style.display = 'block';
          cover.style.background = '#000';
        } else if (audienceScreenMode === 'white') {
          cover.style.display = 'block';
          cover.style.background = '#fff';
        } else {
          cover.style.display = 'none';
        }
      }

      function audienceHandleRemote(data) {
        if (!data) return;
        if (data.type === 'go' && typeof data.idx === 'number') {
          clearAudienceImageFocus();
          if (data.theme) audienceApplyTheme(data.theme);
          if (audienceFrozen) audiencePendingIdx = data.idx;
          else {
            audiencePendingIdx = null;
            audienceGo(data.idx);
          }
        } else if (data.type === 'theme' && data.name) {
          audienceApplyTheme(data.name);
        } else if (data.type === 'screen') {
          setAudienceScreen(data.mode);
        } else if (data.type === 'freeze') {
          audienceFrozen = !!data.value;
          if (!audienceFrozen && audiencePendingIdx !== null) {
            const pending = audiencePendingIdx;
            audiencePendingIdx = null;
            audienceGo(pending);
          }
        } else if (data.type === 'laser') {
          audienceLaser = data.point || null;
          audienceLaserHideAt = Date.now() + 650;
          if (audienceLaserTimer) clearTimeout(audienceLaserTimer);
          audienceLaserTimer = audienceLaser ? setTimeout(() => {
            audienceLaserTimer = null;
            audienceLaser = null;
            drawAudienceInk();
          }, 700) : null;
          drawAudienceInk();
        } else if (data.type === 'circles') {
          audienceCircles = Array.isArray(data.circles) ? data.circles : [];
          drawAudienceInk();
        } else if (data.type === 'clear-ink') {
          audienceCircles = [];
          audienceLaser = null;
          drawAudienceInk();
        } else if (data.type === 'image-focus') {
          setAudienceImageFocus(data);
        } else if (data.type === 'image-focus-clear') {
          clearAudienceImageFocus();
        } else if (data.type === 'close') {
          try { window.close(); } catch(e) { /* ignore */ }
        }
      }

      window.addEventListener('resize', drawAudienceInk);

      if (audienceBc) audienceBc.onmessage = (e) => audienceHandleRemote(e.data);
      window.addEventListener('message', (e) => {
        if (e.data && e.data.source === 'html-ppt-presenter') audienceHandleRemote(e.data);
      });

      /* Ask the presenter to replay slide / theme / screen state, so reopening or
       * reloading this window mid-talk lands on the right slide and theme. */
      if (audienceBc) {
        try { audienceBc.postMessage({ type: 'audience-ready' }); } catch(e) { /* ignore */ }
      }

      audienceGo(audienceIdx);
      return;
    }

    let idx = 0;

    /* ===== BroadcastChannel for presenter sync ===== */
    let bc;
    try { bc = new BroadcastChannel(CHANNEL_NAME); } catch(e) { bc = null; }

    let htmlPptPresenter = null;
    let presentationStartMs = null;

    /* ===== progress bar ===== */
    let bar = document.querySelector('.progress-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'progress-bar';
      bar.innerHTML = '<span></span>';
      document.body.appendChild(bar);
    }
    const barFill = bar.querySelector('span');

    /* ===== notes overlay (N key) ===== */
    let notes = document.querySelector('.notes-overlay');
    if (!notes) {
      notes = document.createElement('div');
      notes.className = 'notes-overlay';
      document.body.appendChild(notes);
    }

    /* ===== overview grid (O key) ===== */
    injectOverviewStyles();
    const overviewItems = [];
    const overviewBaseWidth = 1600;
    const overviewBaseHeight = 1000;
    const overviewAspect = overviewBaseWidth / overviewBaseHeight;
    let overview = document.querySelector('.overview');
    if (!overview) {
      overview = document.createElement('div');
      overview.className = 'overview';
      document.body.appendChild(overview);
    }
    overview.setAttribute('aria-hidden', 'true');
    overview.style.setProperty('--overview-aspect', String(overviewAspect));
    overview.style.setProperty('--overview-base-w', overviewBaseWidth + 'px');
    overview.style.setProperty('--overview-base-h', overviewBaseHeight + 'px');
    overview.innerHTML = '';
    const overviewHeader = document.createElement('div');
    overviewHeader.className = 'overview-header';
    const overviewTitle = document.createElement('div');
    overviewTitle.className = 'overview-title';
    overviewTitle.textContent = '页面总览';
    const overviewCount = document.createElement('div');
    overviewCount.className = 'overview-count';
    overviewCount.textContent = total + ' 页';
    const overviewClose = document.createElement('button');
    overviewClose.type = 'button';
    overviewClose.className = 'overview-close';
    overviewClose.setAttribute('aria-label', '关闭页面总览');
    overviewClose.textContent = '×';
    overviewClose.addEventListener('click', () => toggleOverview(false));
    overviewHeader.append(overviewTitle, overviewCount, overviewClose);
    const overviewGrid = document.createElement('div');
    overviewGrid.className = 'overview-grid';
    overview.append(overviewHeader, overviewGrid);
    slides.forEach((slide, i) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'overview-card';
      card.style.setProperty('--overview-order', String(Math.min(i, 15)));
      card.setAttribute('aria-label', '跳转到第 ' + (i + 1) + ' 页');

      const thumbStage = document.createElement('div');
      thumbStage.className = 'overview-thumb-stage';
      const thumbDeck = document.createElement('div');
      thumbDeck.className = 'overview-thumb-deck';
      thumbDeck.appendChild(cloneSlideForNavigator(slide, i, 'ov'));
      thumbStage.appendChild(thumbDeck);

      const meta = document.createElement('div');
      meta.className = 'overview-meta';
      const num = document.createElement('span');
      num.className = 'overview-num';
      num.textContent = String(i + 1).padStart(2, '0');
      const title = document.createElement('span');
      title.className = 'overview-label';
      title.textContent = getSlideLabel(slide, i);
      meta.append(num, title);

      card.append(thumbStage, meta);
      card.addEventListener('click', () => { go(i); toggleOverview(false); });
      overviewGrid.appendChild(card);
      overviewItems.push(card);
    });

    /* ===== page navigator (E key) ===== */
    injectPageNavigatorStyles();
    const pageNavItems = [];
    const pageNavBaseWidth = 1600;
    const pageNavBaseHeight = 1000;
    const pageNavAspect = pageNavBaseWidth / pageNavBaseHeight;
    let pageNavigator = document.querySelector('.page-navigator');
    if (!pageNavigator) pageNavigator = document.createElement('div');
    pageNavigator.classList.add('page-navigator');
    pageNavigator.setAttribute('aria-hidden', 'true');
    pageNavigator.setAttribute('data-wheel-ignore', '');
    pageNavigator.style.setProperty('--page-nav-aspect', String(pageNavAspect));
    pageNavigator.style.setProperty('--page-nav-base-w', pageNavBaseWidth + 'px');
    pageNavigator.style.setProperty('--page-nav-base-h', pageNavBaseHeight + 'px');
    pageNavigator.innerHTML = '';
    let pageNavigatorMode = null;
    let pageNavigatorHoverOpenTimer = 0;
    let pageNavigatorHoverCloseTimer = 0;

    const pageNavPanel = document.createElement('div');
    pageNavPanel.className = 'page-nav-panel';
    const pageNavHeader = document.createElement('div');
    pageNavHeader.className = 'page-nav-header';
    const pageNavTitle = document.createElement('div');
    pageNavTitle.className = 'page-nav-title';
    pageNavTitle.textContent = '页面导览';
    const pageNavCount = document.createElement('div');
    pageNavCount.className = 'page-nav-count';
    pageNavCount.textContent = total + ' 页';
    const pageNavClose = document.createElement('button');
    pageNavClose.type = 'button';
    pageNavClose.className = 'page-nav-close';
    pageNavClose.setAttribute('aria-label', '关闭页面导览');
    pageNavClose.textContent = '×';
    pageNavClose.addEventListener('click', () => togglePageNavigator(false));
    pageNavHeader.append(pageNavTitle, pageNavCount, pageNavClose);

    const pageNavList = document.createElement('div');
    pageNavList.className = 'page-nav-list';
    pageNavPanel.append(pageNavHeader, pageNavList);
    pageNavigator.appendChild(pageNavPanel);
    pageNavigator.addEventListener('click', e => {
      if (e.target === pageNavigator) togglePageNavigator(false);
    });
    document.body.appendChild(pageNavigator);

    let pageNavHotspot = document.querySelector('.page-nav-hotspot');
    if (!pageNavHotspot) pageNavHotspot = document.createElement('div');
    pageNavHotspot.className = 'page-nav-hotspot';
    pageNavHotspot.setAttribute('aria-hidden', 'true');
    pageNavHotspot.addEventListener('mouseenter', schedulePageNavigatorHoverOpen);
    pageNavHotspot.addEventListener('mousemove', schedulePageNavigatorHoverOpen);
    pageNavHotspot.addEventListener('mouseleave', clearPageNavigatorHoverOpen);
    document.body.appendChild(pageNavHotspot);
    pageNavPanel.addEventListener('mouseenter', clearPageNavigatorHoverClose);
    pageNavPanel.addEventListener('mouseleave', schedulePageNavigatorHoverClose);

    slides.forEach((slide, i) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'page-nav-item';
      item.style.setProperty('--page-nav-order', String(Math.min(i, 9)));
      item.setAttribute('aria-label', '跳转到第 ' + (i + 1) + ' 页');

      const thumbStage = document.createElement('div');
      thumbStage.className = 'page-nav-thumb-stage';
      const thumbDeck = document.createElement('div');
      thumbDeck.className = 'page-nav-thumb-deck';
      thumbDeck.appendChild(cloneSlideForNavigator(slide, i, 'pn'));
      thumbStage.appendChild(thumbDeck);

      const meta = document.createElement('div');
      meta.className = 'page-nav-meta';
      const num = document.createElement('span');
      num.className = 'page-nav-num';
      num.textContent = String(i + 1).padStart(2, '0');
      const title = document.createElement('span');
      title.className = 'page-nav-label';
      title.textContent = getSlideLabel(slide, i);
      meta.append(num, title);

      item.append(thumbStage, meta);
      item.addEventListener('click', () => { go(i); togglePageNavigator(false); });
      pageNavList.appendChild(item);
      pageNavItems.push(item);
    });

    /* Named apart from getSlideTitle(i): two same-named declarations in this
     * scope would hoist-shadow each other and blank out every label. */
    function getSlideLabel(slide, i) {
      const title = slide.getAttribute('data-title') ||
        (slide.querySelector('h1,h2,h3') || {}).textContent ||
        ('第 ' + (i + 1) + ' 页');
      return title.trim().slice(0, 80);
    }

    function escapeRegExp(value) {
      return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function makeCloneIdsUnique(root, suffix) {
      const idMap = new Map();
      root.querySelectorAll('[id]').forEach(el => {
        const oldId = el.getAttribute('id');
        if (!oldId) return;
        const newId = oldId + suffix;
        idMap.set(oldId, newId);
        el.setAttribute('id', newId);
      });
      if (!idMap.size) return;
      const attrs = ['href', 'xlink:href', 'fill', 'stroke', 'filter', 'clip-path', 'mask', 'marker-start', 'marker-mid', 'marker-end'];
      root.querySelectorAll('*').forEach(el => {
        attrs.forEach(attr => {
          const raw = el.getAttribute(attr);
          if (!raw) return;
          let next = raw;
          idMap.forEach((newId, oldId) => {
            next = next.replace(new RegExp('url\\(#' + escapeRegExp(oldId) + '\\)', 'g'), 'url(#' + newId + ')');
            if (next === '#' + oldId) next = '#' + newId;
          });
          if (next !== raw) el.setAttribute(attr, next);
        });
      });
    }

    function cloneSlideForNavigator(slide, i, kind) {
      const clone = slide.cloneNode(true);
      clone.classList.add('is-active');
      clone.classList.remove('is-prev');
      clone.setAttribute('aria-hidden', 'true');
      clone.querySelectorAll('.notes, aside.notes, .speaker-notes, script, style').forEach(el => el.remove());
      clone.querySelectorAll('.counter').forEach(el => {
        const cfg = getCounterConfig(el);
        if (cfg) setCounterValue(el, cfg.target, cfg);
      });
      clone.querySelectorAll('svg text[data-number-original]').forEach(el => {
        el.textContent = el.getAttribute('data-number-original') || el.textContent;
      });
      makeCloneIdsUnique(clone, '-' + (kind || 'nav') + '-' + i);
      return clone;
    }

    function syncPageNavigatorScale() {
      pageNavigator.querySelectorAll('.page-nav-thumb-stage').forEach(stage => {
        const mini = stage.querySelector('.page-nav-thumb-deck');
        if (!mini || !stage.clientWidth) return;
        mini.style.transform = 'scale(' + (stage.clientWidth / pageNavBaseWidth) + ')';
      });
    }

    function syncOverviewScale() {
      updateOverviewGridFit();
      overview.querySelectorAll('.overview-thumb-stage').forEach(stage => {
        const mini = stage.querySelector('.overview-thumb-deck');
        if (!mini || !stage.clientWidth || !stage.clientHeight) return;
        const scale = Math.max(0.01, Math.min(stage.clientWidth / overviewBaseWidth, stage.clientHeight / overviewBaseHeight));
        mini.style.left = ((stage.clientWidth - overviewBaseWidth * scale) / 2) + 'px';
        mini.style.top = ((stage.clientHeight - overviewBaseHeight * scale) / 2) + 'px';
        mini.style.transform = 'scale(' + scale + ')';
      });
    }

    function updateOverviewGridFit() {
      const rect = overview.getBoundingClientRect();
      const width = rect.width || window.innerWidth || 1600;
      const height = rect.height || window.innerHeight || 1000;
      const inset = 12;
      const gap = 10;
      const availableW = Math.max(1, width - inset * 2);
      const availableH = Math.max(1, height - inset * 2);
      let best = { cols: Math.ceil(Math.sqrt(total)), rows: Math.ceil(Math.sqrt(total)), score: -Infinity };
      for (let cols = 1; cols <= total; cols++) {
        const rows = Math.ceil(total / cols);
        const cellW = (availableW - gap * (cols - 1)) / cols;
        const cellH = (availableH - gap * (rows - 1)) / rows;
        if (cellW <= 0 || cellH <= 0) continue;
        const ratioPenalty = Math.abs(Math.log((cellW / cellH) / overviewAspect));
        const emptyPenalty = (cols * rows - total) / (cols * rows);
        const score = cellW * cellH * (1 - Math.min(0.55, ratioPenalty * 0.28)) * (1 - emptyPenalty * 0.18);
        if (score > best.score) best = { cols, rows, score };
      }
      overview.style.setProperty('--overview-cols', String(best.cols));
      overview.style.setProperty('--overview-rows', String(best.rows));
      overview.style.setProperty('--overview-gap', gap + 'px');
    }

    function updateOverviewActive() {
      overviewItems.forEach((item, i) => {
        const active = i === idx;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-current', active ? 'true' : 'false');
      });
    }

    function updatePageNavigatorActive() {
      pageNavItems.forEach((item, i) => {
        const active = i === idx;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-current', active ? 'true' : 'false');
      });
    }

    function clearPageNavigatorHoverClose() {
      if (pageNavigatorHoverCloseTimer) {
        clearTimeout(pageNavigatorHoverCloseTimer);
        pageNavigatorHoverCloseTimer = 0;
      }
    }

    function clearPageNavigatorHoverOpen() {
      if (pageNavigatorHoverOpenTimer) {
        clearTimeout(pageNavigatorHoverOpenTimer);
        pageNavigatorHoverOpenTimer = 0;
      }
      if (!pageNavigator.classList.contains('open')) {
        pageNavHotspot.classList.remove('is-hot');
      }
    }

    function schedulePageNavigatorHoverClose() {
      if (pageNavigatorMode !== 'hover') return;
      clearPageNavigatorHoverClose();
      clearPageNavigatorHoverOpen();
      pageNavigatorHoverCloseTimer = setTimeout(() => {
        if (pageNavigatorMode === 'hover') togglePageNavigator(false);
      }, 120);
    }

    function schedulePageNavigatorHoverOpen() {
      pageNavHotspot.classList.add('is-hot');
      if (pageNavigator.classList.contains('open')) return;
      if (pageNavigatorHoverOpenTimer) return;
      pageNavigatorHoverOpenTimer = setTimeout(() => {
        pageNavigatorHoverOpenTimer = 0;
        if (!pageNavigator.classList.contains('open')) togglePageNavigator(true, 'hover');
      }, 170);
    }

    function togglePageNavigator(force, mode) {
      const wasOpen = pageNavigator.classList.contains('open');
      let open;
      if (force !== undefined) {
        open = force;
      } else if (mode === 'manual' && wasOpen && pageNavigatorMode === 'hover') {
        open = true;
      } else {
        open = !wasOpen;
      }
      clearPageNavigatorHoverClose();
      clearPageNavigatorHoverOpen();
      pageNavigatorMode = open ? (mode || pageNavigatorMode || 'manual') : null;
      pageNavigator.classList.toggle('open', open);
      pageNavHotspot.classList.toggle('is-hot', open && pageNavigatorMode === 'hover');
      pageNavigator.setAttribute('aria-hidden', open ? 'false' : 'true');
      document.body.classList.toggle('page-navigator-open', open);
      if (open) {
        toggleOverview(false);
        toggleNotes(false);
        updatePageNavigatorActive();
        requestAnimationFrame(() => {
          syncPageNavigatorScale();
          const active = pageNavItems[idx];
          if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
        });
      }
    }

    function injectOverviewStyles() {
      if (document.querySelector('style[data-overview-style]')) return;
      const style = document.createElement('style');
      style.setAttribute('data-overview-style', 'true');
      style.textContent = `
.overview {
  position: fixed;
  inset: 0;
  z-index: 90;
  --overview-accent: var(--accent, var(--accent-2, #3b6cff));
  --overview-accent-2: var(--accent-2, var(--accent, #7a5cff));
  --overview-bg-1: color-mix(in srgb, var(--bg, #ffffff) 84%, var(--text-1, #111216) 16%);
  --overview-bg-2: color-mix(in srgb, var(--bg-soft, #f7f7f8) 72%, var(--text-1, #111216) 28%);
  --overview-glass: color-mix(in srgb, var(--surface, #ffffff) 82%, transparent);
  --overview-glass-strong: color-mix(in srgb, var(--surface, #ffffff) 92%, transparent);
  --overview-line: color-mix(in srgb, var(--border-strong, rgba(0,0,0,.18)) 72%, var(--overview-accent) 28%);
  --overview-muted: color-mix(in srgb, var(--text-2, #55596a) 78%, var(--bg, #ffffff) 22%);
  display: block;
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
  padding: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at 12% 10%, color-mix(in srgb, var(--overview-accent) 15%, transparent), transparent 32%),
    radial-gradient(circle at 88% 14%, color-mix(in srgb, var(--accent-3, var(--overview-accent)) 12%, transparent), transparent 34%),
    linear-gradient(135deg, var(--overview-bg-1), var(--overview-bg-2));
  -webkit-backdrop-filter: blur(12px) saturate(1.06);
  backdrop-filter: blur(12px) saturate(1.06);
  transition: opacity 0.24s ease, visibility 0s linear 0.24s;
}
.overview.open {
  display: block;
  visibility: visible;
  opacity: 1;
  pointer-events: auto;
  transition: opacity 0.24s ease, visibility 0s;
}
.overview-header {
  position: absolute;
  top: 10px;
  left: 12px;
  right: 12px;
  z-index: 3;
  display: none;
  align-items: center;
  gap: 8px;
  min-height: 26px;
  color: var(--text-1, #111216);
}
.overview-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  line-height: 1.15;
  font-weight: 850;
}
.overview-title::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--overview-accent), var(--overview-accent-2));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--overview-accent) 14%, transparent);
}
.overview-count {
  margin-left: auto;
  color: var(--overview-muted);
  font-size: 12px;
  font-weight: 800;
}
.overview-close {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 1px solid var(--overview-line);
  border-radius: 9px;
  background: var(--overview-glass);
  color: var(--text-1, #111216);
  font-size: 19px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.18s ease, transform 0.18s ease;
}
.overview-close:hover,
.overview-close:focus-visible {
  outline: none;
  background: var(--overview-glass-strong);
  transform: translateY(-1px);
}
.overview-grid {
  position: absolute;
  inset: 12px;
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(var(--overview-cols, 5), minmax(0, 1fr));
  grid-template-rows: repeat(var(--overview-rows, 4), minmax(0, 1fr));
  align-content: stretch;
  gap: var(--overview-gap, 12px);
  padding: 0;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.overview-grid::-webkit-scrollbar {
  width: 0;
  height: 0;
}
.overview-card {
  position: relative;
  display: grid;
  grid-template-rows: minmax(0, 1fr) 24px;
  gap: 5px;
  min-width: 0;
  min-height: 0;
  padding: 6px;
  overflow: hidden;
  border: 1px solid var(--overview-line);
  border-radius: calc(var(--radius-sm, 12px) + 4px);
  background: var(--overview-glass);
  color: var(--text-1, #111216);
  text-align: left;
  cursor: pointer;
  box-shadow: var(--shadow-lg, 0 18px 46px rgba(0, 0, 0, 0.14));
  -webkit-backdrop-filter: blur(14px) saturate(1.04);
  backdrop-filter: blur(14px) saturate(1.04);
  opacity: 0;
  transform: translateY(12px);
  transition:
    opacity 0.26s ease,
    transform 0.3s cubic-bezier(.2, .85, .2, 1),
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}
.overview.open .overview-card {
  opacity: 1;
  transform: translateY(0);
  transition-delay: calc(var(--overview-order, 0) * 14ms), calc(var(--overview-order, 0) * 14ms), 0s, 0s;
}
.overview-card:hover,
.overview-card:focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--overview-accent) 58%, var(--border-strong, rgba(0,0,0,.2)));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--overview-accent) 18%, transparent), var(--shadow-lg, 0 20px 54px rgba(0,0,0,.16));
}
.overview-card.is-active {
  border-color: color-mix(in srgb, var(--overview-accent) 78%, var(--border-strong, rgba(0,0,0,.2)));
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--overview-accent) 22%, transparent),
    var(--shadow-lg, 0 22px 58px rgba(0, 0, 0, 0.18));
}
.overview-thumb-stage {
  position: relative;
  inset: auto;
  width: 100%;
  height: 100%;
  min-height: 0;
  aspect-ratio: auto;
  overflow: hidden;
  border-radius: 10px;
  background: var(--bg, #fff);
  border: 1px solid color-mix(in srgb, var(--border, rgba(0,0,0,.1)) 68%, transparent);
}
.overview-card::after {
  display: none;
}
.overview-thumb-deck {
  position: absolute;
  top: 0;
  left: 0;
  width: var(--overview-base-w, 1600px);
  height: var(--overview-base-h, 1000px);
  transform-origin: 0 0;
  pointer-events: none;
}
.overview-thumb-deck .slide {
  position: absolute !important;
  inset: 0 !important;
  display: flex !important;
  width: var(--overview-base-w, 1600px) !important;
  height: var(--overview-base-h, 1000px) !important;
  opacity: 1 !important;
  pointer-events: none !important;
  transform: none !important;
  transition: none !important;
}
.overview-thumb-deck .notes,
.overview-thumb-deck aside.notes,
.overview-thumb-deck .speaker-notes {
  display: none !important;
}
.overview-meta {
  position: relative;
  left: auto;
  right: auto;
  bottom: auto;
  z-index: 2;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 7px;
  align-items: center;
  min-height: 0;
  height: 24px;
  padding: 0 3px 1px;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}
.overview-num {
  min-width: 28px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--overview-accent);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 1.2;
  font-weight: 800;
  text-align: center;
}
.overview-card.is-active .overview-num {
  background: transparent;
  color: var(--overview-accent);
  border-color: transparent;
}
.overview-label {
  overflow: hidden;
  color: var(--text-1, #243247);
  font-size: 13px;
  line-height: 1.2;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 900px) {
  .overview-grid {
    inset: 10px;
  }
  .overview-header {
    top: 8px;
    left: 10px;
    right: 10px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .overview,
  .overview-card {
    transition: none !important;
  }
}
`;
      document.head.appendChild(style);
    }

    function injectPageNavigatorStyles() {
      if (document.querySelector('style[data-page-navigator-style]')) return;
      const style = document.createElement('style');
      style.setAttribute('data-page-navigator-style', 'true');
      style.textContent = `
.page-navigator {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: block;
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
  background:
    linear-gradient(90deg,
      color-mix(in srgb, var(--bg) 70%, transparent) 0%,
      color-mix(in srgb, var(--surface) 48%, transparent) 28%,
      color-mix(in srgb, var(--bg) 30%, transparent) 100%),
    linear-gradient(135deg,
      color-mix(in srgb, var(--accent) 8%, transparent),
      color-mix(in srgb, var(--accent-2) 8%, transparent));
  -webkit-backdrop-filter: blur(5px) saturate(1.03);
  backdrop-filter: blur(5px) saturate(1.03);
  transition:
    opacity 0.28s ease,
    visibility 0s linear 0.28s,
    backdrop-filter 0.28s ease;
}
.page-navigator.open {
  visibility: visible;
  opacity: 1;
  pointer-events: auto;
  transition:
    opacity 0.28s ease,
    visibility 0s,
    backdrop-filter 0.28s ease;
}
.page-nav-hotspot {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 79;
  width: 8px;
  background: transparent;
  pointer-events: auto;
}
.page-nav-hotspot::before {
  content: "";
  position: absolute;
  top: 16px;
  bottom: 16px;
  left: 0;
  width: 3px;
  border-radius: 0;
  opacity: 0;
  transform: scaleY(0.82);
  transform-origin: center;
  background: var(--grad, linear-gradient(180deg, var(--accent), var(--accent-2), var(--accent-3)));
  box-shadow:
    0 0 12px color-mix(in srgb, var(--accent) 48%, transparent),
    0 0 24px color-mix(in srgb, var(--accent-2) 28%, transparent);
  transition: opacity 0.12s ease, transform 0.18s cubic-bezier(.2, .85, .2, 1);
}
.page-nav-hotspot:hover::before,
.page-nav-hotspot.is-hot::before {
  opacity: 1;
  transform: scaleY(1);
}
.page-nav-panel {
  position: relative;
  box-sizing: border-box;
  width: min(206px, 16vw);
  min-width: 196px;
  height: 100%;
  padding: 10px 6px 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  overflow: visible;
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--surface) 96%, transparent),
      color-mix(in srgb, var(--bg-soft, var(--bg)) 92%, transparent)),
    linear-gradient(90deg,
      color-mix(in srgb, var(--surface) 74%, transparent),
      color-mix(in srgb, var(--accent) 10%, transparent));
  border-right: 0;
  border-radius: 0;
  box-shadow:
    inset -1px 0 0 color-mix(in srgb, var(--surface) 70%, transparent),
    5px 0 16px color-mix(in srgb, var(--text-1) 9%, transparent);
  transform: translateX(-18px);
  opacity: 0;
  transition:
    transform 0.24s cubic-bezier(.2, .85, .2, 1),
    opacity 0.18s ease;
}
.page-nav-panel::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 1px;
  background: var(--grad, linear-gradient(180deg, var(--accent), var(--accent-2), var(--accent-3)));
  opacity: 0.74;
}
.page-nav-panel::after {
  content: "";
  position: absolute;
  top: 0;
  right: -7px;
  width: 8px;
  height: 100%;
  z-index: 2;
  background:
    linear-gradient(90deg,
      color-mix(in srgb, var(--accent-2) 28%, transparent) 0,
      color-mix(in srgb, var(--accent) 18%, transparent) 1px,
      color-mix(in srgb, var(--accent-2) 6%, transparent) 48%,
      transparent 100%);
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--accent-2) 12%, transparent));
  pointer-events: none;
}
.page-navigator.open .page-nav-panel {
  transform: translateX(0);
  opacity: 1;
}
.page-nav-header {
  flex: none;
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 2px 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  color: var(--text-1);
}
.page-nav-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  line-height: 1.2;
  font-weight: 900;
}
.page-nav-title::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--grad, linear-gradient(135deg, var(--accent), var(--accent-2)));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 9%, transparent);
}
.page-nav-count {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 2px;
  color: var(--text-2);
  font-size: 14px;
  line-height: 1.25;
  font-weight: 750;
  letter-spacing: 0;
}
.page-nav-close {
  width: 22px;
  height: 22px;
  margin-left: 0;
  display: grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface-2, var(--surface)) 45%, transparent);
  color: var(--text-2);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  box-shadow: none;
  opacity: 0.86;
  transition:
    transform 0.16s ease,
    background 0.16s ease,
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    color 0.16s ease,
    opacity 0.16s ease;
}
.page-nav-close:hover,
.page-nav-close:focus-visible {
  outline: none;
  opacity: 1;
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  color: var(--text-1);
  border-color: color-mix(in srgb, var(--border-strong, var(--border)) 55%, transparent);
  transform: translateY(-1px);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--surface) 86%, transparent),
    0 6px 14px color-mix(in srgb, var(--text-1) 10%, transparent);
}
.page-nav-list {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 2px 2px 10px 0;
  display: grid;
  grid-template-columns: 1fr;
  gap: 5px;
  scrollbar-width: none;
  -ms-overflow-style: none;
  mask-image: linear-gradient(to bottom, transparent 0, #000 10px, #000 calc(100% - 16px), transparent 100%);
}
.page-nav-list::-webkit-scrollbar {
  width: 0;
  height: 0;
}
.page-nav-item {
  width: 100%;
  display: grid;
  grid-template-columns: 1fr;
  gap: 2px;
  padding: 2px 3px 5px;
  border: 1px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--text-1);
  text-align: left;
  cursor: pointer;
  box-shadow: none;
  opacity: 0;
  transform: translateX(-8px);
  transition:
    opacity 0.2s ease,
    transform 0.22s cubic-bezier(.2, .85, .2, 1),
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    background 0.18s ease;
}
.page-navigator.open .page-nav-item {
  opacity: 1;
  transform: translateX(0);
  transition-delay: calc(var(--page-nav-order, 0) * 18ms), calc(var(--page-nav-order, 0) * 18ms), 0s, 0s, 0s;
}
.page-nav-item:hover,
.page-nav-item:focus-visible {
  outline: none;
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  transform: translateY(-1px);
}
.page-nav-item.is-active {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
}
.page-nav-thumb-stage {
  position: relative;
  width: 100%;
  aspect-ratio: var(--page-nav-aspect, 1.6);
  overflow: hidden;
  border-radius: 7px;
  background: var(--surface);
  border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
  box-shadow: 0 3px 10px color-mix(in srgb, var(--text-1) 6%, transparent);
}
.page-nav-item:hover .page-nav-thumb-stage,
.page-nav-item:focus-visible .page-nav-thumb-stage {
  border-color: color-mix(in srgb, var(--accent) 42%, var(--border));
  box-shadow: 0 5px 14px color-mix(in srgb, var(--accent) 10%, transparent);
}
.page-nav-item.is-active .page-nav-thumb-stage {
  border-color: color-mix(in srgb, var(--accent) 70%, var(--border));
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--accent) 16%, transparent),
    0 6px 16px color-mix(in srgb, var(--accent) 12%, transparent);
}
.page-nav-thumb-deck {
  position: absolute;
  top: 0;
  left: 0;
  width: var(--page-nav-base-w, 1600px);
  height: var(--page-nav-base-h, 1000px);
  transform-origin: 0 0;
  pointer-events: none;
}
.page-nav-thumb-deck .slide {
  position: absolute !important;
  inset: 0 !important;
  display: flex !important;
  width: var(--page-nav-base-w, 1600px) !important;
  height: var(--page-nav-base-h, 1000px) !important;
  opacity: 1 !important;
  pointer-events: none !important;
  transform: none !important;
  transition: none !important;
}
.page-nav-thumb-deck .notes,
.page-nav-thumb-deck aside.notes,
.page-nav-thumb-deck .speaker-notes {
  display: none !important;
}
.page-nav-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 0 1px;
}
.page-nav-num {
  flex: none;
  width: fit-content;
  min-width: 28px;
  padding: 2px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 14px;
  line-height: 1.2;
  font-weight: 900;
  text-align: center;
}
.page-nav-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--text-1);
  font-size: 14px;
  line-height: 1.25;
  font-weight: 850;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.page-nav-item.is-active .page-nav-num {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}
@media (max-width: 760px) {
  .page-nav-panel {
    width: min(70vw, 206px);
    min-width: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .page-navigator,
  .page-nav-panel,
  .page-nav-item {
    transition: none !important;
  }
}
`;
      document.head.appendChild(style);
    }

    window.addEventListener('resize', () => {
      syncPageNavigatorScale();
      syncOverviewScale();
    });

    /* ===== navigation ===== */
    let navReady = false;
    function go(n, fromRemote){
      n = Math.max(0, Math.min(total-1, n));
      if (navReady && n === idx) return;
      slides.forEach((s,i) => {
        s.classList.toggle('is-active', i===n);
        s.classList.toggle('is-prev', i<n);
      });
      idx = n;
      updatePageNavigatorActive();
      updateOverviewActive();
      barFill.style.width = ((n+1)/total*100)+'%';
      const numEl = document.querySelector('.slide-number');
      if (numEl) { numEl.setAttribute('data-current', n+1); numEl.setAttribute('data-total', total); }

      // notes (bottom overlay)
      const note = slides[n].querySelector('.notes, aside.notes, .speaker-notes');
      notes.innerHTML = note ? note.innerHTML : '';

      // hash
      const hashTarget = '#/'+(n+1);
      if (location.hash !== hashTarget) {
        history.replaceState(null,'', hashTarget);
      }

      // re-trigger entry animations
      slides[n].querySelectorAll('[data-anim]').forEach(el => {
        const a = el.getAttribute('data-anim');
        el.classList.remove('anim-'+a);
        void el.offsetWidth;
        el.classList.add('anim-'+a);
      });

      animateCounters(slides[n]);
      navReady = true;

      // Broadcast to other window (audience ↔ presenter)
      if (!fromRemote && bc) {
        bc.postMessage({ type: 'go', idx: n, theme: root.getAttribute('data-theme') || '' });
      }
      if (htmlPptPresenter && htmlPptPresenter.isActive()) {
        htmlPptPresenter.onExternalGo(n);
      }
    }

    function getSlideTitle(i) {
      const s = slides[i];
      if (!s) return '';
      return s.getAttribute('data-title') ||
        (s.querySelector('h1,h2,h3') || {}).textContent ||
        ('Slide ' + (i + 1));
    }
    function getSlideNotes(i) {
      const s = slides[i];
      if (!s) return '';
      const note = s.querySelector('.notes, aside.notes, .speaker-notes');
      return note ? note.innerHTML : '';
    }
    function getSlideId(i) {
      const s = slides[i];
      if (!s) return 'slide-' + String(i + 1).padStart(2, '0');
      return s.getAttribute('data-slide-id') || ('slide-' + String(i + 1).padStart(2, '0'));
    }
    function getSpeakerNotesCatalog() {
      return Array.isArray(window.__SPEAKER_NOTES__) ? window.__SPEAKER_NOTES__ : [];
    }

    /* ===== listen for remote navigation / theme changes ===== */
    if (bc) {
      bc.onmessage = function(e) {
        if (!e.data) return;
        if (e.data.type === 'audience-ready') {
          if (htmlPptPresenter && htmlPptPresenter.pushState) htmlPptPresenter.pushState();
        } else if (e.data.type === 'image-focus-clear') {
          if (htmlPptPresenter && htmlPptPresenter.clearImageFocusRemote) {
            htmlPptPresenter.clearImageFocusRemote();
          }
        } else if (e.data.type === 'go' && typeof e.data.idx === 'number') {
          go(e.data.idx, true);
        } else if (e.data.type === 'theme' && e.data.name) {
          /* Sync theme across windows */
          const i = themes.indexOf(e.data.name);
          if (i >= 0) themeIdx = i;
          applyTheme(e.data.name);
        } else if (e.data.type === 'notes-update' && typeof e.data.idx === 'number') {
          const slide = slides[e.data.idx];
          if (!slide) return;
          let note = slide.querySelector('.notes, aside.notes, .speaker-notes');
          if (!note) {
            note = document.createElement('aside');
            note.className = 'notes';
            slide.appendChild(note);
          }
          note.innerHTML = e.data.html || '';
          if (e.data.idx === idx) notes.innerHTML = note.innerHTML;
        }
      };
    }

    function toggleNotes(force){ notes.classList.toggle('open', force!==undefined?force:!notes.classList.contains('open')); }
    function toggleOverview(force){
      const open = force !== undefined ? force : !overview.classList.contains('open');
      overview.classList.toggle('open', open);
      overview.setAttribute('aria-hidden', open ? 'false' : 'true');
      if (open) {
        togglePageNavigator(false);
        toggleNotes(false);
        updateOverviewActive();
        requestAnimationFrame(() => {
          syncOverviewScale();
          const active = overviewItems[idx];
          if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
        });
      }
    }

    /* ===== mouse wheel navigation ===== */
    let wheelAccum = 0;
    let lastWheelEventAt = 0;
    let lastWheelNavAt = 0;
    const WHEEL_THRESHOLD = 90;
    const WHEEL_COOLDOWN = 360;

    function shouldBlockDeckNavigationForEditor(e) {
      if (!(document.body && document.body.classList.contains('html-ppt-editor-active'))) return false;
      const target = e && e.target && e.target.closest
        ? e.target.closest('input, textarea, select, [contenteditable="true"], .html-ppt-editor-ui')
        : null;
      return !!target;
    }

    function shouldIgnoreWheel(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return true;
      const target = e.target && e.target.closest
        ? e.target.closest('input, textarea, select, [contenteditable="true"], .notes-overlay.open, .overview.open, .page-navigator.open, .hpp-note-editor, .hpp-overview-grid, [data-wheel-ignore]')
        : null;
      return !!target;
    }

    function handleWheelNavigate(delta) {
      if (htmlPptPresenter && htmlPptPresenter.isActive()) {
        if (htmlPptPresenter.isOverviewOpen && htmlPptPresenter.isOverviewOpen()) return false;
        return htmlPptPresenter.navigate(delta);
      }
      go(idx + delta);
      return true;
    }

    document.addEventListener('wheel', function(e) {
      if (shouldBlockDeckNavigationForEditor(e)) return;
      if (shouldIgnoreWheel(e)) return;
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      const now = Date.now();
      if (now - lastWheelEventAt > 300) wheelAccum = 0;
      lastWheelEventAt = now;
      wheelAccum += e.deltaY;
      if (Math.abs(wheelAccum) < WHEEL_THRESHOLD) return;
      if (now - lastWheelNavAt < WHEEL_COOLDOWN) {
        e.preventDefault();
        return;
      }
      handleWheelNavigate(wheelAccum > 0 ? 1 : -1);
      wheelAccum = 0;
      lastWheelNavAt = now;
      e.preventDefault();
    }, { passive: false });

    function fullscreen(){ const el=document.documentElement;
      if (!document.fullscreenElement) el.requestFullscreen&&el.requestFullscreen();
      else document.exitFullscreen&&document.exitFullscreen();
    }

    // theme cycling
    const root = document.documentElement;
    const themesAttr = root.getAttribute('data-themes') || document.body.getAttribute('data-themes');
    function normalizeThemeName(value) {
      const raw = String(value || '').trim();
      if (!raw) return '';
      const clean = raw.split(/[?#]/)[0].replace(/\\/g, '/');
      const file = clean.substring(clean.lastIndexOf('/') + 1);
      return file.replace(/\.css$/i, '').trim();
    }
    const themes = themesAttr
      ? Array.from(new Set(themesAttr.split(',').map(normalizeThemeName).filter(Boolean)))
      : [];
    let themeIdx = 0;

    // Auto-detect theme base path from existing <link id="theme-link">
    let themeBase = root.getAttribute('data-theme-base');
    if (!themeBase) {
      const existingLink = document.getElementById('theme-link');
      if (existingLink) {
        // el.getAttribute('href') gives the raw relative path written in HTML
        const rawHref = existingLink.getAttribute('href') || '';
        const lastSlash = rawHref.lastIndexOf('/');
        themeBase = lastSlash >= 0 ? rawHref.substring(0, lastSlash + 1) : 'assets/themes/';
      } else {
        themeBase = 'assets/themes/';
      }
    }

    function applyTheme(name) {
      name = normalizeThemeName(name);
      if (!name) return;
      let link = document.getElementById('theme-link');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'stylesheet';
        link.id = 'theme-link';
        document.head.appendChild(link);
      }
      link.href = themeBase + name + '.css';
      root.setAttribute('data-theme', name);
      const ind = document.querySelector('.theme-indicator');
      if (ind) ind.textContent = name;
    }
    (function initThemeState() {
      if (!themes.length) return;
      const existingLink = document.getElementById('theme-link');
      const currentTheme = normalizeThemeName(root.getAttribute('data-theme')) ||
        normalizeThemeName(existingLink && (existingLink.getAttribute('href') || existingLink.href));
      const currentIdx = themes.indexOf(currentTheme);
      themeIdx = currentIdx >= 0 ? currentIdx : 0;
      applyTheme(themes[themeIdx]);
    })();
    function cycleTheme(fromRemote){
      if (!themes.length) return;
      themeIdx = (themeIdx+1) % themes.length;
      const name = themes[themeIdx];
      applyTheme(name);
      /* Broadcast to other window (audience ↔ presenter) */
      if (!fromRemote && bc) bc.postMessage({ type: 'theme', name: name });
    }

    function initHtmlPptPresenter() {
      if (!window.HtmlPptPresenter || htmlPptPresenter) return;
      htmlPptPresenter = window.HtmlPptPresenter.create({
        total: total,
        getIdx: () => idx,
        go: (n) => go(n),
        getDeckBaseUrl: getDeckBaseUrl,
        bc: bc,
        getSlideTitle: getSlideTitle,
        getSlideNotes: getSlideNotes,
        getSlideId: getSlideId,
        getSpeakerNotesCatalog: getSpeakerNotesCatalog,
        getTheme: () => root.getAttribute('data-theme') || (themes[themeIdx] || ''),
        getPresentationStart: () => presentationStartMs,
        setPresentationStart: (ms) => { presentationStartMs = ms; },
        sessionId: 'deck-' + location.pathname.replace(/\W+/g, '-')
      });
    }
    loadPresenterAssets(initHtmlPptPresenter);

    function isPresenterTypingTarget(e) {
      if (!(htmlPptPresenter && htmlPptPresenter.isActive())) return false;
      const target = e && e.target && e.target.closest
        ? e.target.closest('input, textarea, select, [contenteditable="true"], .hpp-note-editor')
        : null;
      return !!target;
    }

    document.addEventListener('keydown', function (e) {
      if (shouldBlockDeckNavigationForEditor(e)) return;
      if (htmlPptPresenter && htmlPptPresenter.isActive()) {
        if (isPresenterTypingTarget(e)) return;
        if (htmlPptPresenter.handleKey(e)) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === 'f' || e.key === 'F') { fullscreen(); return; }
        if (e.key === 't' || e.key === 'T') {
          cycleTheme();
          if (htmlPptPresenter.syncTheme) htmlPptPresenter.syncTheme();
          else if (htmlPptPresenter.syncPreviewTheme) htmlPptPresenter.syncPreviewTheme();
          return;
        }
        return;
      }
      if (htmlPptPresenter && htmlPptPresenter.handleKey(e)) return;
      if (e.metaKey||e.ctrlKey||e.altKey) return;
      switch (e.key) {
        case 'ArrowRight': case ' ': case 'PageDown': case 'Enter': go(idx+1); e.preventDefault(); break;
        case 'ArrowLeft': case 'PageUp': case 'Backspace': go(idx-1); e.preventDefault(); break;
        case 'Home': go(0); break;
        case 'End': go(total-1); break;
        case 'f': case 'F': fullscreen(); break;
        case 'n': case 'N': toggleNotes(); break;
        case 'o': case 'O': toggleOverview(); e.preventDefault(); break;
        case 'e': case 'E': togglePageNavigator(); e.preventDefault(); break;
        case 't': case 'T': cycleTheme(); break;
        case 'Escape': togglePageNavigator(false); toggleOverview(false); toggleNotes(false); break;
      }
    });

    // hash deep-link. Apply once here; hashchange covers later edits.
    // replaceState inside go() does not fire hashchange, so this cannot loop.
    function hashIndex(){
      const m = /^#\/(\d+)/.exec(location.hash||'');
      if (!m) return null;
      return Math.max(0, Math.min(total-1, parseInt(m[1],10)-1));
    }
    window.addEventListener('hashchange', function(){
      const n = hashIndex();
      if (n !== null) go(n);
    });
    const initialHash = hashIndex();
    if (initialHash !== null) idx = initialHash;
    go(idx);
    loadDeckEditorAssets();
  });
})();
