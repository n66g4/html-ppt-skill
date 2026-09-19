/**
 * html-ppt-skill :: presenter.js — in-page presenter overlay (guizang-style)
 * Phase 1–3: overlay, audience sync, SPEAKER_NOTES, grid, auto-advance, ink, screen control
 */
(function (global) {
  'use strict';

  var BASE_W = 1920;
  var BASE_H = 1080;

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function formatClock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor((s % 3600) / 60)) + ':' + pad2(s % 60);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isTypingTarget(target) {
    return !!(target && target.closest &&
      target.closest('input, textarea, select, [contenteditable="true"], .hpp-note-editor'));
  }

  function valueLines(value) {
    if (Array.isArray(value)) {
      return value.filter(Boolean).map(function (x) { return '• ' + x; }).join('\n');
    }
    return value ? String(value) : '';
  }

  function createPresenter(deps) {
    var active = false;
    var audienceWin = null;
    var audiencePoll = null;
    var startMs = 0;
    var tickTimer = null;
    var saveTimer = null;
    var root = null;
    var previewStack = null;
    var overviewPanel = null;
    var overviewGrid = null;
    var curFrame = null;
    var curViewport = null;
    var curFrameBox = null;
    var nextFrame = null;
    var imageFocusSrc = null;
    var notesTitleEl = null;
    var notesPurposeEl = null;
    var noteEditor = null;
    var noteSize = 17;
    var noteMetaEl = null;
    var notesStatusEl = null;
    var syncEl = null;
    var pageEl = null;
    var elapsedEl = null;
    var curLabelEl = null;
    var nextLabelEl = null;
    var overviewOpen = false;
    var renderedNoteId = '';
    var sessionId = deps.sessionId || ('s' + Date.now().toString(36));
    var slideElapsed = [];
    var timedSlideIndex = 0;
    var slideTimerStartedAt = 0;
    var autoEnabled = false;
    var autoFallbackMs = 60000;
    var autoDeadline = 0;
    var annotationTool = 'none';
    var annotationPointerDown = false;
    var annotationStart = null;
    var draftCircle = null;
    var circles = [];
    var laserPoint = null;
    var laserHideAt = 0;
    var lastLaserSent = 0;
    var laserFadeTimer = null;
    var inkCanvas = null;
    var slideClockEl = null;
    var slidePlanEl = null;
    var slideStatusEl = null;
    var autoBtn = null;
    var screenMode = 'normal';
    var audienceFrozen = false;

    function storageKey(name) {
      return 'html-ppt-presenter-' + name + ':v1:' + location.pathname;
    }

    try {
      autoEnabled = localStorage.getItem(storageKey('auto-enabled')) === '1';
      var savedAuto = parseInt(localStorage.getItem(storageKey('auto-seconds')) || '60', 10);
      if (Number.isFinite(savedAuto) && savedAuto > 0) autoFallbackMs = savedAuto * 1000;
    } catch (_) { /* ignore */ }

    function plannedMsAt(i) {
      var n = noteAt(i);
      if (n.minutes && n.minutes > 0) return Math.round(n.minutes * 60000);
      return autoFallbackMs;
    }

    function currentSlideElapsed(i) {
      i = typeof i === 'number' ? i : deps.getIdx();
      var base = slideElapsed[i] || 0;
      if (timedSlideIndex === i) base += Date.now() - slideTimerStartedAt;
      return base;
    }

    function commitSlideTime() {
      var now = Date.now();
      slideElapsed[timedSlideIndex] = (slideElapsed[timedSlideIndex] || 0) + (now - slideTimerStartedAt);
      slideTimerStartedAt = now;
    }

    function rollSlideTimer(nextIndex) {
      commitSlideTime();
      timedSlideIndex = nextIndex;
      slideTimerStartedAt = Date.now();
      armAutoAdvance();
    }

    function armAutoAdvance() {
      autoDeadline = autoEnabled ? Date.now() + plannedMsAt(deps.getIdx()) : 0;
    }

    function checkAutoAdvance() {
      if (!autoEnabled || overviewOpen || !active) return;
      if (autoDeadline && Date.now() >= autoDeadline) {
        var idx = deps.getIdx();
        if (idx < deps.total - 1) navigate(1);
        else autoDeadline = 0;
      }
    }

    function renderTimer() {
      var idx = deps.getIdx();
      var pageUsed = currentSlideElapsed(idx);
      var target = plannedMsAt(idx);
      if (slideClockEl) slideClockEl.textContent = formatClock(pageUsed);
      if (slidePlanEl) slidePlanEl.textContent = target ? ('计划 ' + formatClock(target)) : '计划 —';
      if (slideStatusEl) {
        if (!target) {
          slideStatusEl.textContent = '—';
          slideStatusEl.className = 'hpp-time-value';
        } else if (pageUsed > target) {
          slideStatusEl.textContent = formatClock(pageUsed - target);
          slideStatusEl.className = 'hpp-time-value is-over';
        } else {
          slideStatusEl.textContent = formatClock(target - pageUsed);
          slideStatusEl.className = 'hpp-time-value is-remaining';
        }
      }
      if (autoBtn) {
        autoBtn.classList.toggle('is-on', autoEnabled);
        autoBtn.textContent = autoEnabled ? '自动翻页 · 开' : '自动翻页 · 关';
      }
    }

    function toggleAutoAdvance() {
      autoEnabled = !autoEnabled;
      try { localStorage.setItem(storageKey('auto-enabled'), autoEnabled ? '1' : '0'); } catch (_) { /* ignore */ }
      armAutoAdvance();
      renderTimer();
    }

    function updateSessionButtons() {
      if (!root) return;
      var states = {
        'screen-black': screenMode === 'black',
        'screen-white': screenMode === 'white',
        'freeze': audienceFrozen
      };
      Object.keys(states).forEach(function (action) {
        var btn = root.querySelector('[data-action="' + action + '"]');
        if (btn) btn.classList.toggle('is-on', states[action]);
      });
    }

    function setScreenMode(mode) {
      var next = mode || 'normal';
      screenMode = (next !== 'normal' && screenMode === next) ? 'normal' : next;
      postAudience({ type: 'screen', mode: screenMode });
      updateSessionButtons();
    }

    function setAudienceFreeze(value) {
      audienceFrozen = !!value;
      postAudience({ type: 'freeze', value: audienceFrozen });
      updateSessionButtons();
    }

    function syncInk() {
      postAudience({ type: 'circles', circles: circles });
      if (laserPoint) postAudience({ type: 'laser', point: laserPoint });
    }

    /* Annotation coordinates are normalized against the 16:9 slide area, not the
     * letterboxed viewport, so they land on the same spot on the audience screen. */
    function slideBox() {
      if (curFrameBox && curFrameBox.w > 0 && curFrameBox.h > 0) return curFrameBox;
      var w = inkCanvas ? inkCanvas.width : 0;
      var h = inkCanvas ? inkCanvas.height : 0;
      return { left: 0, top: 0, w: w, h: h };
    }

    function drawInk() {
      if (!inkCanvas) return;
      var viewport = inkCanvas.parentElement;
      var cw = viewport ? viewport.clientWidth : window.innerWidth;
      var ch = viewport ? viewport.clientHeight : window.innerHeight;
      inkCanvas.width = cw;
      inkCanvas.height = ch;
      inkCanvas.style.width = cw + 'px';
      inkCanvas.style.height = ch + 'px';
      var ctx = inkCanvas.getContext('2d');
      ctx.clearRect(0, 0, cw, ch);
      var box = slideBox();
      if (!box.w || !box.h) return;
      ctx.strokeStyle = '#ff5b63';
      ctx.lineWidth = Math.max(2, box.w * 0.003);

      function strokeEllipse(c, dashed) {
        var x = box.left + ((c.x1 + c.x2) / 2) * box.w;
        var y = box.top + ((c.y1 + c.y2) / 2) * box.h;
        var rx = Math.abs(c.x2 - c.x1) * box.w / 2;
        var ry = Math.abs(c.y2 - c.y1) * box.h / 2;
        if (dashed) ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.ellipse(x, y, Math.max(8, rx), Math.max(8, ry), 0, 0, Math.PI * 2);
        ctx.stroke();
        if (dashed) ctx.setLineDash([]);
      }

      circles.forEach(function (c) { strokeEllipse(c, false); });
      if (laserPoint && Date.now() < laserHideAt) {
        var lx = box.left + laserPoint.x * box.w;
        var ly = box.top + laserPoint.y * box.h;
        var r = Math.max(6, box.w * 0.007);
        var g = ctx.createRadialGradient(lx, ly, 0, lx, ly, r * 3);
        g.addColorStop(0, 'rgba(255,91,99,.95)');
        g.addColorStop(1, 'rgba(255,91,99,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(lx, ly, r * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      if (draftCircle) strokeEllipse(draftCircle, true);
    }

    function annotationPoint(event) {
      var rect = inkCanvas.getBoundingClientRect();
      var box = slideBox();
      if (!box.w || !box.h) return { x: 0, y: 0 };
      return {
        x: Math.min(1, Math.max(0, (event.clientX - rect.left - box.left) / box.w)),
        y: Math.min(1, Math.max(0, (event.clientY - rect.top - box.top) / box.h))
      };
    }

    function updateImagePickable() {
      if (!curViewport) return;
      curViewport.classList.toggle('is-image-pickable',
        active && !overviewOpen && annotationTool === 'none');
    }

    function clearImageFocus() {
      if (!imageFocusSrc) return;
      imageFocusSrc = null;
      postAudience({ type: 'image-focus-clear' });
    }

    function setImageFocus(src, alt) {
      if (!src) return;
      if (imageFocusSrc === src) {
        clearImageFocus();
        return;
      }
      imageFocusSrc = src;
      postAudience({ type: 'image-focus', src: src, alt: alt || '' });
    }

    function setAnnotationTool(tool) {
      annotationTool = annotationTool === tool ? 'none' : tool;
      annotationPointerDown = false;
      draftCircle = null;
      if (inkCanvas) {
        inkCanvas.classList.toggle('is-active', annotationTool !== 'none');
      }
      if (root) {
        root.querySelectorAll('[data-annot-tool]').forEach(function (btn) {
          btn.classList.toggle('is-active', btn.getAttribute('data-annot-tool') === annotationTool);
        });
      }
      updateImagePickable();
      drawInk();
    }

    function clearAnnotations() {
      if (laserFadeTimer) {
        clearTimeout(laserFadeTimer);
        laserFadeTimer = null;
      }
      circles = [];
      draftCircle = null;
      laserPoint = null;
      postAudience({ type: 'clear-ink' });
      drawInk();
    }

    /* The laser only redraws on pointer move, so without this the dot would
     * stay frozen on both screens once the pointer stops. */
    function scheduleLaserFade() {
      if (laserFadeTimer) clearTimeout(laserFadeTimer);
      laserFadeTimer = setTimeout(function () {
        laserFadeTimer = null;
        if (!laserPoint) return;
        laserPoint = null;
        postAudience({ type: 'laser', point: null });
        drawInk();
      }, 700);
    }

    function onInkPointerDown(event) {
      if (annotationTool === 'circle') {
        event.preventDefault();
        annotationPointerDown = true;
        annotationStart = annotationPoint(event);
        draftCircle = { x1: annotationStart.x, y1: annotationStart.y, x2: annotationStart.x, y2: annotationStart.y };
        inkCanvas.setPointerCapture && inkCanvas.setPointerCapture(event.pointerId);
        drawInk();
      }
    }

    function onInkPointerMove(event) {
      if (annotationTool === 'laser') {
        var point = annotationPoint(event);
        laserPoint = point;
        laserHideAt = Date.now() + 650;
        if (Date.now() - lastLaserSent > 32) {
          lastLaserSent = Date.now();
          postAudience({ type: 'laser', point: point });
        }
        scheduleLaserFade();
        drawInk();
        return;
      }
      if (annotationTool === 'circle' && annotationPointerDown && draftCircle) {
        var p = annotationPoint(event);
        draftCircle.x2 = p.x;
        draftCircle.y2 = p.y;
        drawInk();
      }
    }

    function onInkPointerUp(event) {
      if (annotationTool !== 'circle' || !annotationPointerDown || !draftCircle) return;
      event.preventDefault();
      annotationPointerDown = false;
      circles.push({
        x1: draftCircle.x1, y1: draftCircle.y1,
        x2: draftCircle.x2, y2: draftCircle.y2
      });
      draftCircle = null;
      syncInk();
      drawInk();
    }

    function onInkPointerLeave() {
      if (annotationTool === 'laser') {
        laserPoint = null;
        postAudience({ type: 'laser', point: null });
        drawInk();
      }
    }

    function notesCatalog() {
      return deps.getSpeakerNotesCatalog ? deps.getSpeakerNotesCatalog() : [];
    }

    function slideId(i) {
      if (deps.getSlideId) return deps.getSlideId(i);
      return 'slide-' + pad2(i + 1);
    }

    function noteAt(i) {
      var id = slideId(i);
      var list = notesCatalog();
      for (var j = 0; j < list.length; j++) {
        if (list[j] && list[j].id === id) return list[j];
      }
      return {
        id: id,
        title: deps.getSlideTitle ? deps.getSlideTitle(i) : ('第 ' + (i + 1) + ' 页'),
        section: '',
        minutes: 0,
        purpose: '',
        talk: [],
        transition: ''
      };
    }

    function noteStorageKey(id) {
      return 'html-ppt-presenter-note:v1:' + location.pathname + ':' + id;
    }

    function htmlToPlainText(html) {
      if (!html) return '';
      var el = document.createElement('div');
      el.innerHTML = html;
      return (el.textContent || '').trim();
    }

    function generatedNote(note) {
      var parts = [];
      var talkText = valueLines(note.talk);
      if (talkText) parts.push('【讲述要点】\n' + talkText);
      if (note.transition) parts.push('【转场】\n' + note.transition);
      var optional = [
        ['舞台提示', note.cue],
        ['互动', note.interaction],
        ['表达提示', note.delivery],
        ['翻页时机', note.advance],
        ['备用方案', note.fallback],
        ['读音提醒', note.pronunciation]
      ];
      optional.forEach(function (pair) {
        var text = valueLines(pair[1]);
        if (text) parts.push('【' + pair[0] + '】\n' + text);
      });
      return parts.join('\n\n') || '—';
    }

    function loadDraftNote(id, idx, note) {
      try {
        var saved = localStorage.getItem(noteStorageKey(id));
        if (saved !== null) return saved;
      } catch (_) { /* ignore */ }
      var generated = generatedNote(note);
      if (generated && generated !== '—') return generated;
      if (deps.getSlideNotes) {
        var aside = htmlToPlainText(deps.getSlideNotes(idx));
        if (aside) return aside;
      }
      return '—';
    }

    function setNoteSize(value, persist) {
      noteSize = Math.max(14, Math.min(26, value));
      document.documentElement.style.setProperty('--hpp-note-size', noteSize + 'px');
      if (persist !== false) {
        try { localStorage.setItem(storageKey('note-size'), String(noteSize)); } catch (_) { /* ignore */ }
      }
    }

    function flushDraftNote() {
      if (!noteEditor || !renderedNoteId) return;
      clearTimeout(saveTimer);
      saveTimer = null;
      try {
        localStorage.setItem(noteStorageKey(renderedNoteId), noteEditor.value);
      } catch (_) { /* ignore */ }
    }

    function deckBase() {
      return deps.getDeckBaseUrl ? deps.getDeckBaseUrl() : (location.pathname + location.search.split('&audience')[0].split('?audience')[0]);
    }

    function audienceUrl() {
      var slide = String(deps.getIdx() + 1);
      try {
        var url = new URL(deckBase(), location.href);
        url.search = '';
        url.hash = '';
        url.searchParams.set('audience', '1');
        url.searchParams.set('slide', slide);
        url.searchParams.set('session', sessionId);
        return url.href;
      } catch (_) {
        var base = deckBase();
        var sep = base.indexOf('?') >= 0 ? '&' : '?';
        return base + sep + 'audience=1&slide=' + slide + '&session=' + encodeURIComponent(sessionId);
      }
    }

    function setSyncState(state) {
      if (!syncEl) return;
      syncEl.dataset.state = state;
      var labels = {
        synced: '观众屏已同步',
        connecting: '正在连接观众屏…',
        disconnected: '观众屏未连接',
        blocked: '弹窗被拦截'
      };
      syncEl.textContent = labels[state] || state;
    }

    function broadcast(msg) {
      var payload = Object.assign({ type: msg.type || 'go' }, msg);
      delete payload.cmd;
      if (audienceWin && !audienceWin.closed) {
        try {
          audienceWin.postMessage(Object.assign({ source: 'html-ppt-presenter' }, payload), '*');
        } catch (_) { /* ignore */ }
      }
      if (deps.bc) {
        try {
          deps.bc.postMessage(payload);
        } catch (_) { /* ignore */ }
      }
    }

    function postAudience(msg) {
      broadcast(msg);
    }

    function openAudience() {
      var url = audienceUrl();
      /* No 'noopener': that makes window.open() return null, which would leave
       * the sync indicator stuck on "blocked" and break closing on exit. */
      audienceWin = window.open(url, 'html-ppt-audience-' + sessionId);
      if (!audienceWin) {
        setSyncState('blocked');
        return;
      }
      setSyncState('connecting');
      if (audiencePoll) clearInterval(audiencePoll);
      audiencePoll = setInterval(function () {
        if (!audienceWin || audienceWin.closed) {
          setSyncState('disconnected');
          clearInterval(audiencePoll);
          audiencePoll = null;
          return;
        }
        setSyncState('synced');
      }, 2000);
    }

    function previewSrc(idx) {
      try {
        var url = new URL(deckBase(), location.href);
        url.search = '';
        url.hash = '';
        url.searchParams.set('preview', String(idx + 1));
        return url.href;
      } catch (_) {
        var base = deckBase();
        var sep = base.indexOf('?') >= 0 ? '&' : '?';
        return base + sep + 'preview=' + (idx + 1);
      }
    }

    function updatePreviewFrame(frame, slideIndex, total) {
      if (!frame) return;
      if (slideIndex < 0 || slideIndex >= total) {
        if (frame.dataset.slideIndex !== 'none') {
          frame.dataset.slideIndex = 'none';
          if (frame.src && frame.src !== 'about:blank') frame.src = 'about:blank';
          frame.dataset.loaded = '';
        }
        return;
      }
      var key = String(slideIndex);
      if (frame.dataset.slideIndex === key) return;

      var hasLoaded = frame.dataset.loaded === '1' && frame.src && frame.src !== 'about:blank';
      if (!hasLoaded) {
        frame.dataset.slideIndex = key;
        frame.src = previewSrc(slideIndex);
        frame.addEventListener('load', function onPreviewLoad() {
          frame.dataset.loaded = '1';
        }, { once: true });
        return;
      }

      frame.dataset.slideIndex = key;
      try {
        if (frame.contentWindow) {
          frame.contentWindow.postMessage({ type: 'preview-goto', idx: slideIndex }, '*');
        }
      } catch (_) {
        frame.dataset.loaded = '';
        frame.src = previewSrc(slideIndex);
      }
    }

    function syncPreviewTheme() {
      var theme = deps.getTheme ? deps.getTheme() : '';
      if (!theme) return;
      [curFrame, nextFrame].forEach(function (frame) {
        if (!frame || !frame.contentWindow || frame.dataset.loaded !== '1') return;
        try {
          frame.contentWindow.postMessage({ type: 'preview-theme', name: theme }, '*');
        } catch (_) { /* ignore */ }
      });
    }

    function fitFrame(frame, viewport) {
      if (!frame || !viewport) return;
      var cw = viewport.clientWidth;
      var ch = viewport.clientHeight;
      if (cw <= 0 || ch <= 0) return;
      var scale = Math.min(cw / BASE_W, ch / BASE_H);
      var w = BASE_W * scale;
      var h = BASE_H * scale;
      var left = Math.round((cw - w) / 2);
      var top = Math.round((ch - h) / 2);
      frame.style.transform = 'scale(' + scale + ')';
      frame.style.left = left + 'px';
      frame.style.top = top + 'px';
      if (frame === curFrame) curFrameBox = { left: left, top: top, w: w, h: h };
    }

    function fitAllFrames() {
      if (!root) return;
      root.querySelectorAll('.hpp-frame-viewport').forEach(function (vp) {
        fitFrame(vp.querySelector('.hpp-frame'), vp);
      });
    }

    function buildOverviewGrid() {
      if (!overviewGrid) return;
      overviewGrid.innerHTML = '';
      var idx = deps.getIdx();
      var total = deps.total;
      for (var i = 0; i < total; i++) {
        var n = noteAt(i);
        (function (slideIndex) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'hpp-overview-page' + (slideIndex === idx ? ' is-current' : '');
          btn.innerHTML =
            '<span class="hpp-overview-page-no">' + pad2(slideIndex + 1) + ' / ' + pad2(total) + '</span>' +
            '<span class="hpp-overview-page-title">' + escapeHtml(n.title || slideId(slideIndex)) + '</span>' +
            '<span class="hpp-overview-page-meta"><span>' + escapeHtml(n.section || '未分组') + '</span>' +
            '<span>' + Math.round(((slideIndex + 1) / total) * 100) + '%</span></span>';
          btn.addEventListener('click', function () {
            goTo(slideIndex);
            setOverview(false);
          });
          overviewGrid.appendChild(btn);
        })(i);
      }
    }

    function setOverview(open) {
      overviewOpen = open;
      if (previewStack) previewStack.classList.toggle('is-overview', overviewOpen);
      if (overviewPanel) overviewPanel.hidden = !overviewOpen;
      var gridBtn = root && root.querySelector('[data-action="toggle-grid"]');
      if (gridBtn) gridBtn.classList.toggle('is-active', overviewOpen);
      if (overviewOpen) {
        clearImageFocus();
        setAnnotationTool('none');
        buildOverviewGrid();
      }
      updateImagePickable();
      if (!overviewOpen) {
        requestAnimationFrame(function () {
          fitAllFrames();
          drawInk();
        });
      }
    }

    function toggleOverview() {
      setOverview(!overviewOpen);
    }

    function saveDraftNote() {
      if (!noteEditor || !renderedNoteId) return;
      if (notesStatusEl) {
        notesStatusEl.textContent = '保存中…';
        notesStatusEl.classList.remove('is-saved');
      }
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        flushDraftNote();
        if (notesStatusEl) {
          notesStatusEl.textContent = '已保存';
          notesStatusEl.classList.add('is-saved');
        }
      }, 280);
    }

    function updateNotes(idx) {
      var n = noteAt(idx);
      var id = slideId(idx);
      var target = plannedMsAt(idx);
      if (notesTitleEl) notesTitleEl.textContent = n.title || ('第 ' + (idx + 1) + ' 页');
      if (notesPurposeEl) notesPurposeEl.textContent = n.purpose || '—';
      if (noteMetaEl) {
        noteMetaEl.textContent = '建议 ' + (target ? (target / 60000).toFixed(1) : '—') + ' 分钟 · ' + id;
      }
      if (renderedNoteId !== id && noteEditor) {
        flushDraftNote();
        renderedNoteId = id;
        noteEditor.value = loadDraftNote(id, idx, n);
        noteEditor.scrollTop = 0;
        if (notesStatusEl) {
          notesStatusEl.textContent = '已保存';
          notesStatusEl.classList.add('is-saved');
        }
      }
    }

    function syncFrames() {
      var idx = deps.getIdx();
      var total = deps.total;
      var next = idx + 1 < total ? idx + 1 : -1;
      updatePreviewFrame(curFrame, idx, total);
      updatePreviewFrame(nextFrame, next, total);
      syncPreviewTheme();
      if (curLabelEl) curLabelEl.textContent = (idx + 1) + ' / ' + total;
      if (nextLabelEl) nextLabelEl.textContent = idx >= total - 1 ? '已到尾页' : ((next + 1) + ' / ' + total);
      if (pageEl) {
        pageEl.innerHTML = '<strong>' + (idx + 1) + ' / ' + total + '</strong>' +
          '<span>' + escapeHtml(noteAt(idx).title || slideId(idx)) + '</span>';
      }
      updateNotes(idx);
      if (overviewOpen) buildOverviewGrid();
    }

    function tick() {
      if (!active) return;
      var now = Date.now();
      if (elapsedEl) elapsedEl.textContent = formatClock(now - startMs);
      renderTimer();
      checkAutoAdvance();
    }

    function navigate(delta) {
      var idx = deps.getIdx() + delta;
      if (idx < 0 || idx >= deps.total) return false;
      clearImageFocus();
      rollSlideTimer(idx);
      deps.go(idx);
      syncFrames();
      postAudience({ type: 'go', idx: idx, theme: deps.getTheme ? deps.getTheme() : null });
      return true;
    }

    function goTo(idx) {
      if (idx < 0 || idx >= deps.total) return;
      clearImageFocus();
      rollSlideTimer(idx);
      deps.go(idx);
      syncFrames();
      postAudience({ type: 'go', idx: idx, theme: deps.getTheme ? deps.getTheme() : null });
    }

    function buildDOM() {
      root = document.createElement('div');
      root.id = 'html-ppt-presenter';
      root.innerHTML =
        '<header class="hpp-top">' +
          '<div class="hpp-brand">演讲者视图</div>' +
          '<div class="hpp-meta">' +
            '<span class="hpp-sync" data-state="disconnected">观众屏未连接</span>' +
            '<button type="button" class="hpp-btn" data-action="open-audience">打开观众屏</button>' +
            '<button type="button" class="hpp-btn" data-action="exit">退出</button>' +
          '</div>' +
        '</header>' +
        '<main class="hpp-main">' +
          '<section class="hpp-preview-stack">' +
            '<div class="hpp-stage-card">' +
              '<div class="hpp-stage-label">' +
                '<span>当前页 <span data-role="cur-label">—</span></span>' +
                '<span class="hpp-annot-tools">' +
                  '<button type="button" class="hpp-btn hpp-grid-btn" data-action="toggle-grid" title="宫格 (G)">宫格</button>' +
                  '<button type="button" class="hpp-btn" data-annot-tool="laser" title="激光 (L)">激光</button>' +
                  '<button type="button" class="hpp-btn" data-annot-tool="circle" title="圈选 (C)">圈选</button>' +
                  '<button type="button" class="hpp-btn" data-action="clear-ink" title="清除 (X)">清除</button>' +
                '</span>' +
              '</div>' +
              '<div class="hpp-frame-viewport"><iframe class="hpp-frame" title="当前页" loading="lazy"></iframe><canvas class="hpp-annotation-layer" aria-hidden="true"></canvas></div>' +
            '</div>' +
            '<div class="hpp-stage-card hpp-next-card">' +
              '<div class="hpp-stage-label"><span>下一页</span><span data-role="next-label">—</span></div>' +
              '<div class="hpp-frame-viewport"><iframe class="hpp-frame" title="下一页" loading="lazy"></iframe></div>' +
            '</div>' +
            '<div class="hpp-overview" hidden>' +
              '<div class="hpp-overview-head"><strong>宫格选页</strong><span class="hpp-muted">Esc 返回预览</span></div>' +
              '<div class="hpp-overview-grid"></div>' +
            '</div>' +
          '</section>' +
          '<aside class="hpp-notes-card">' +
            '<div class="hpp-notes-head">' +
              '<div class="hpp-notes-label">标题</div>' +
              '<div class="hpp-notes-title" data-role="notes-title">—</div>' +
              '<div class="hpp-purpose-block">' +
                '<div class="hpp-notes-label">本页目的</div>' +
                '<div class="hpp-purpose-copy" data-role="notes-purpose">—</div>' +
              '</div>' +
              '<div class="hpp-notes-draft-head">' +
                '<div>' +
                  '<div class="hpp-notes-label">草稿（备注）</div>' +
                  '<div class="hpp-note-meta" data-role="note-meta"></div>' +
                '</div>' +
                '<span class="hpp-notes-tools">' +
                  '<span class="hpp-notes-status is-saved">已保存</span>' +
                  '<button type="button" class="hpp-btn" data-action="note-smaller" title="缩小备注字号">A−</button>' +
                  '<button type="button" class="hpp-btn" data-action="note-larger" title="放大备注字号">A+</button>' +
                '</span>' +
              '</div>' +
            '</div>' +
            '<textarea class="hpp-note-editor" spellcheck="false" aria-label="本页演讲备注"></textarea>' +
          '</aside>' +
        '</main>' +
        '<footer class="hpp-bottom">' +
          '<div class="hpp-time-dashboard">' +
            '<div class="hpp-time-stat"><span class="hpp-time-label">已用时间</span><span class="hpp-time-value" data-role="elapsed">00:00:00</span></div>' +
            '<div class="hpp-time-stat"><span class="hpp-time-label">本页</span><span class="hpp-time-value" data-role="slide-clock">00:00:00</span><span class="hpp-time-hint" data-role="slide-plan">计划 —</span></div>' +
            '<div class="hpp-time-stat"><span class="hpp-time-label">差值</span><span class="hpp-time-value" data-role="slide-status">—</span></div>' +
          '</div>' +
          '<div class="hpp-control-stack">' +
            '<div class="hpp-controls">' +
              '<button type="button" class="hpp-btn" data-action="prev">← 上一页</button>' +
              '<button type="button" class="hpp-btn" data-action="next">下一页 →</button>' +
            '</div>' +
            '<div class="hpp-session-actions">' +
              '<button type="button" class="hpp-btn" data-action="auto">自动翻页 · 关</button>' +
              '<button type="button" class="hpp-btn" data-action="screen-black" title="黑屏 (B)">黑屏</button>' +
              '<button type="button" class="hpp-btn" data-action="screen-white" title="白屏 (W)">白屏</button>' +
              '<button type="button" class="hpp-btn" data-action="screen-normal">恢复</button>' +
              '<button type="button" class="hpp-btn" data-action="freeze">冻结</button>' +
            '</div>' +
          '</div>' +
          '<div class="hpp-page-state" data-role="page"></div>' +
        '</footer>';

      previewStack = root.querySelector('.hpp-preview-stack');
      overviewPanel = root.querySelector('.hpp-overview');
      overviewGrid = root.querySelector('.hpp-overview-grid');
      curViewport = root.querySelector('.hpp-preview-stack .hpp-stage-card:first-child .hpp-frame-viewport');
      curFrame = curViewport ? curViewport.querySelector('.hpp-frame') : null;
      nextFrame = root.querySelector('.hpp-next-card .hpp-frame');
      inkCanvas = root.querySelector('.hpp-annotation-layer');
      notesTitleEl = root.querySelector('[data-role="notes-title"]');
      notesPurposeEl = root.querySelector('[data-role="notes-purpose"]');
      noteEditor = root.querySelector('.hpp-note-editor');
      noteMetaEl = root.querySelector('[data-role="note-meta"]');
      notesStatusEl = root.querySelector('.hpp-notes-status');
      syncEl = root.querySelector('.hpp-sync');
      pageEl = root.querySelector('[data-role="page"]');
      elapsedEl = root.querySelector('[data-role="elapsed"]');
      slideClockEl = root.querySelector('[data-role="slide-clock"]');
      slidePlanEl = root.querySelector('[data-role="slide-plan"]');
      slideStatusEl = root.querySelector('[data-role="slide-status"]');
      autoBtn = root.querySelector('[data-action="auto"]');
      curLabelEl = root.querySelector('[data-role="cur-label"]');
      nextLabelEl = root.querySelector('[data-role="next-label"]');

      root.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-action]');
        if (!btn) return;
        var action = btn.getAttribute('data-action');
        if (action === 'exit') exit(true);
        else if (action === 'open-audience') openAudience();
        else if (action === 'toggle-grid') toggleOverview();
        else if (action === 'clear-ink') clearAnnotations();
        else if (action === 'auto') toggleAutoAdvance();
        else if (action === 'screen-black') setScreenMode('black');
        else if (action === 'screen-white') setScreenMode('white');
        else if (action === 'screen-normal') setScreenMode('normal');
        else if (action === 'freeze') setAudienceFreeze(!audienceFrozen);
        else if (action === 'note-smaller') setNoteSize(noteSize - 1);
        else if (action === 'note-larger') setNoteSize(noteSize + 1);
        else if (action === 'prev') navigate(-1);
        else if (action === 'next') navigate(1);
      });

      root.querySelectorAll('[data-annot-tool]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          setAnnotationTool(btn.getAttribute('data-annot-tool'));
        });
      });

      if (noteEditor) {
        noteEditor.addEventListener('input', saveDraftNote);
        noteEditor.addEventListener('blur', function () {
          flushDraftNote();
          if (notesStatusEl) {
            notesStatusEl.textContent = '已保存';
            notesStatusEl.classList.add('is-saved');
          }
        });
      }
      if (inkCanvas) {
        inkCanvas.addEventListener('pointerdown', onInkPointerDown);
        inkCanvas.addEventListener('pointermove', onInkPointerMove);
        inkCanvas.addEventListener('pointerup', onInkPointerUp);
        inkCanvas.addEventListener('pointercancel', onInkPointerUp);
        inkCanvas.addEventListener('pointerleave', onInkPointerLeave);
      }

      document.body.appendChild(root);
      window.addEventListener('message', function (e) {
        if (!active || !e.data) return;
        if (e.data.type === 'preview-image-click') {
          if (annotationTool !== 'none' || overviewOpen) return;
          if (!curFrame || e.source !== curFrame.contentWindow) return;
          setImageFocus(e.data.src, e.data.alt);
          return;
        }
        if (e.data.type === 'preview-key' && e.data.key === 'Escape') {
          if (!curFrame || e.source !== curFrame.contentWindow) return;
          if (imageFocusSrc) clearImageFocus();
        }
      });
      window.addEventListener('resize', function () {
        fitAllFrames();
        drawInk();
      });
    }

    function ensureHint() {
      if (document.getElementById('html-ppt-presenter-hint')) return;
      var hint = document.createElement('button');
      hint.id = 'html-ppt-presenter-hint';
      hint.type = 'button';
      hint.className = 'hpp-deck-hint';
      hint.innerHTML = '演讲者模式 <kbd>P</kbd>';
      hint.addEventListener('click', enter);
      document.body.appendChild(hint);
    }

    function enter() {
      if (active) return;
      /* Mirror of editor.js blocking V while presenting: the editor UI is not
       * hidden by presenter.css, so the two modes must not overlap. */
      if (document.body && document.body.classList.contains('html-ppt-editor-active')) return;
      if (!root) buildDOM();
      try {
        var savedSize = parseInt(localStorage.getItem(storageKey('note-size')) || '17', 10);
        if (Number.isFinite(savedSize)) noteSize = savedSize;
      } catch (_) { /* ignore */ }
      setNoteSize(noteSize, false);
      active = true;
      overviewOpen = false;
      renderedNoteId = '';
      slideElapsed = Array(deps.total).fill(0);
      timedSlideIndex = deps.getIdx();
      slideTimerStartedAt = Date.now();
      circles = [];
      screenMode = 'normal';
      audienceFrozen = false;
      imageFocusSrc = null;
      startMs = Date.now();
      if (deps.setPresentationStart) deps.setPresentationStart(startMs);
      armAutoAdvance();
      document.body.classList.add('html-ppt-presenter-active');
      setOverview(false);
      updateImagePickable();
      updateSessionButtons();
      [curFrame, nextFrame].forEach(function (frame) {
        if (!frame) return;
        frame.dataset.slideIndex = '';
        frame.dataset.loaded = '';
      });
      syncFrames();
      fitAllFrames();
      setTimeout(fitAllFrames, 120);
      setTimeout(fitAllFrames, 400);
      openAudience();
      tick();
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = setInterval(tick, 1000);
      postAudience({ type: 'clear-ink' });
      postAudience({ type: 'screen', mode: 'normal' });
      postAudience({ type: 'go', idx: deps.getIdx(), theme: deps.getTheme ? deps.getTheme() : null });
    }

    function exit(force) {
      if (!active) return;
      if (overviewOpen && !force) {
        setOverview(false);
        return;
      }
      flushDraftNote();
      clearImageFocus();
      active = false;
      document.body.classList.remove('html-ppt-presenter-active');
      updateImagePickable();
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = null;
      if (audiencePoll) clearInterval(audiencePoll);
      audiencePoll = null;
      postAudience({ type: 'close' });
      if (audienceWin && !audienceWin.closed) {
        try { audienceWin.close(); } catch (_) { /* ignore */ }
      }
      audienceWin = null;
      setSyncState('disconnected');
    }

    function handleKey(e) {
      if (!active) {
        if ((e.key === 'p' || e.key === 'P') && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          enter();
          return true;
        }
        return false;
      }
      if (isTypingTarget(e.target)) return false;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (imageFocusSrc) {
          clearImageFocus();
          return true;
        }
        exit();
        return true;
      }
      if ((e.key === 'g' || e.key === 'G') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        toggleOverview();
        return true;
      }
      if ((e.key === 'l' || e.key === 'L') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setAnnotationTool('laser');
        return true;
      }
      if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setAnnotationTool('circle');
        return true;
      }
      if ((e.key === 'x' || e.key === 'X') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        clearAnnotations();
        return true;
      }
      if ((e.key === 'b' || e.key === 'B') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setScreenMode('black');
        return true;
      }
      if ((e.key === 'w' || e.key === 'W') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setScreenMode('white');
        return true;
      }
      if (overviewOpen) return true;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        navigate(1);
        return true;
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'Backspace') {
        e.preventDefault();
        navigate(-1);
        return true;
      }
      if (e.key === 'Home') {
        e.preventDefault();
        goTo(0);
        return true;
      }
      if (e.key === 'End') {
        e.preventDefault();
        goTo(deps.total - 1);
        return true;
      }
      return false;
    }

    function onExternalGo() {
      if (!active) return;
      clearAnnotations();
      syncFrames();
    }

    function syncTheme() {
      var theme = deps.getTheme ? deps.getTheme() : '';
      if (!theme) return;
      postAudience({ type: 'theme', name: theme });
      syncPreviewTheme();
    }

    /* A freshly (re)loaded audience window knows nothing about the running
     * session, so replay the full state when it announces itself. */
    function pushState() {
      if (!active) return;
      var theme = deps.getTheme ? deps.getTheme() : '';
      if (theme) postAudience({ type: 'theme', name: theme });
      postAudience({ type: 'screen', mode: screenMode });
      postAudience({ type: 'circles', circles: circles });
      postAudience({ type: 'go', idx: deps.getIdx(), theme: theme });
      postAudience({ type: 'freeze', value: audienceFrozen });
    }

    ensureHint();

    return {
      enter: enter,
      exit: exit,
      isActive: function () { return active; },
      isOverviewOpen: function () { return overviewOpen; },
      handleKey: handleKey,
      navigate: navigate,
      toggleOverview: toggleOverview,
      onExternalGo: onExternalGo,
      syncPreviewTheme: syncPreviewTheme,
      syncTheme: syncTheme,
      pushState: pushState,
      openAudience: openAudience
    };
  }

  global.HtmlPptPresenter = { create: createPresenter };
})(typeof window !== 'undefined' ? window : global);
