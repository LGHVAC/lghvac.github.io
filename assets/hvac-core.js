/*!
 * hvac-core.js — 2026 HVAC Expert Seminar 공통 코어 & 클라우드 실시간 브릿지 & 보안 문서 뷰어
 *
 * 모든 페이지(index / checkin / qna / quiz / qr / admin)에서 공통으로 동작합니다.
 *  1) 관리자 테마(hvac_theme_settings) 즉시 적용 (깜빡임 방지)
 *  2) 공식 링크(hvac_site_links) 일괄 치환 — data-hvac-link 태깅으로 재적용 가능
 *  3) 사이트 긴급 공지 배너(hvac_notice_banner) 렌더링
 *  4) 배포 설정 파일(site-config.json) 동기화
 *  5) Firebase Realtime Database 초경량 REST + 변경시각(updatedAt) 감지 브릿지
 *     - 200명 동시 체크인 원자적 순번 채번(ETag 트랜잭션)
 *     - 실시간 체크인 명부 / 실시간 Q&A 질문·공감 / 실시간 퀴즈 점수 집계
 *     - 관리자 설정 변경 시 전 참석자 화면 실시간 반영 (Page Visibility API 연동)
 *  6) 보안 열람 전용(Read-Only DRM) 문서 뷰어 모달
 *     - Google Drive / PDF 다운로드 툴바 제거(/preview, #toolbar=0)
 *     - 참석자 실명·이메일·순번 대각선 워터마크 오버레이
 *     - 우클릭·드래그·인쇄(@media print)·캡처 단축키·포커스 이탈 시 자동 블러 보호
 */
(function () {
  'use strict';

  // -------------------------------------------------------------
  // 카카오톡 인앱 브라우저 감지 시 스마트폰 기본 외부 브라우저(크롬 / 사파리)로 즉시 자동 탈출
  // -------------------------------------------------------------
  try {
    var _ua = navigator.userAgent || '';
    if (/KAKAOTALK/i.test(_ua)) {
      var _curUrl = window.location.href;
      if (/Android/i.test(_ua)) {
        var _rawUrl = _curUrl.replace(/^https?:\/\//i, '');
        window.location.href = 'intent://' + _rawUrl + '#Intent;scheme=https;package=com.android.chrome;end;';
      } else if (/iPhone|iPad|iPod/i.test(_ua)) {
        window.location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(_curUrl);
      }
    }
  } catch (e) {}

  var CONFIG_KEYS = [
    'hvac_schedule_settings',
    'hvac_theme_settings',
    'hvac_site_links',
    'hvac_site_content',
    'hvac_quiz_config',
    'hvac_quiz_unlocked_sessions',
    'hvac_quiz_scoring_policy',
    'hvac_notice_banner',
    'hvac_milestone_events',
    'hvac_survey_config',
    'hvac_checkin_passcode',
    'hvac_game_config'
  ];
  var APPLIED_MARKER = 'hvac_config_applied_at';
  var CLOUD_CFG_KEY = 'hvac_cloud_config';

  var scriptEl = document.currentScript;
  var BASE = scriptEl && scriptEl.src ? scriptEl.src.replace(/assets\/hvac-core\.js.*$/, '') : './';

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }

  function writeLocalSilent(key, val) {
    try {
      if (val === null || val === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
    } catch (e) {}
  }

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
    });
  }

  function pageId() {
    var explicit = document.documentElement.getAttribute('data-hvac-page');
    if (explicit) return explicit;
    var p = location.pathname;
    if (/\/qr\//.test(p)) return 'qr';
    if (/admin\.html$/.test(p)) return 'admin';
    if (/checkin\.html$/.test(p)) return 'checkin';
    if (/qna\.html$/.test(p)) return 'qna';
    if (/quiz\.html$/.test(p)) return 'quiz';
    if (/game\.html$/.test(p)) return 'game';
    if (/game-leaderboard\.html$/.test(p) || /lunch-screen\.html$/.test(p)) return 'game-leaderboard';
    if (/attendance-dashboard\.html$/.test(p)) return 'attendance-dashboard';
    if (/mc-qna\.html$/.test(p)) return 'qna';
    if (/quiz-winners\.html$/.test(p)) return 'quiz';
    return 'index';
  }

  function getSiteBaseUrl() {
    var links = read('hvac_site_links') || {};
    if (links.siteBaseUrl && String(links.siteBaseUrl).trim()) {
      return String(links.siteBaseUrl).trim().replace(/\/+$/, '');
    }
    if (location.protocol.startsWith('http')) {
      var pathDir = location.pathname.replace(/\/qr\/index\.html$/, '/').replace(/\/[^/]*\.html$/, '/').replace(/\/+$/, '');
      return location.origin + pathDir;
    }
    return 'https://lghvac.github.io';
  }

  // ---------------------------------------------------------
  // 1) 테마
  // ---------------------------------------------------------
  function applyTheme() {
    if (pageId() === 'admin') return; // 관리자 콘솔 자체 UI는 고유 다크 테마 유지
    var theme = read('hvac_theme_settings');
    var styleEl = document.getElementById('hvac-custom-theme-style');
    if (!theme || !theme.vars) {
      if (styleEl) styleEl.remove();
      return;
    }
    var css = ':root {\n';
    Object.keys(theme.vars).forEach(function (k) {
      css += '  ' + k + ': ' + theme.vars[k] + ' !important;\n';
    });
    css += '}\n';
    if (theme.gradient) {
      css += 'body, .hero, .bg-canvas, .bg-gradient { background: ' + theme.gradient + ' !important; }\n';
    }
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'hvac-custom-theme-style';
      (document.head || document.documentElement).appendChild(styleEl);
    }
    styleEl.textContent = css;
  }

  // ---------------------------------------------------------
  // 2) 링크
  // ---------------------------------------------------------
  var LINK_RULES = [
    { key: 'kakaoChat', test: function (h) { return /pf\.kakao\.com/.test(h) && /\/chat/.test(h); } },
    { key: 'kakaoChannel', test: function (h) { return /pf\.kakao\.com/.test(h); } },
    { key: 'attendanceForm', test: function (h) { return /\/r\/kaugdHpUxh/.test(h); } },
    { key: 'surveyForm', test: function (h) { return /ResponsePage\.aspx|forms\.cloud\.microsoft/.test(h); } },
    { key: 'googleMapUrl', test: function (h) { return /maps\.app\.goo\.gl|google\.[a-z.]+\/maps/.test(h); } },
    { key: 'mapUrl', test: function (h) { return /map\.naver\.com|map\.kakao\.com/.test(h); } }
  ];

  function tagLinks(root) {
    (root || document).querySelectorAll('a[href]:not([data-hvac-link])').forEach(function (a) {
      var h = a.getAttribute('href') || '';
      for (var i = 0; i < LINK_RULES.length; i++) {
        if (LINK_RULES[i].test(h)) {
          a.setAttribute('data-hvac-link', LINK_RULES[i].key);
          break;
        }
      }
    });
  }

  function applyLinks(root) {
    if (pageId() === 'admin') return;
    tagLinks(root);
    var links = read('hvac_site_links');
    if (!links) return;
    (root || document).querySelectorAll('a[data-hvac-link]').forEach(function (a) {
      var key = a.getAttribute('data-hvac-link');
      var url = links[key];
      if (!url && key === 'kakaoChat' && links.kakaoChannel) url = links.kakaoChannel;
      if (url) a.setAttribute('href', url);
    });
  }

  function getLink(key, fallback) {
    var links = read('hvac_site_links') || {};
    return links[key] || fallback || '';
  }

  // ---------------------------------------------------------
  // 3) 긴급 공지 배너
  // ---------------------------------------------------------
  var BANNER_STYLE = {
    info: { bg: 'rgba(16, 133, 72, 0.96)', border: '#22c55e', icon: '📢' },
    warn: { bg: 'rgba(180, 120, 10, 0.97)', border: '#f3c448', icon: '⚠️' },
    urgent: { bg: 'rgba(190, 18, 40, 0.97)', border: '#ff6677', icon: '🚨' }
  };

  function renderBanner() {
    var old = document.getElementById('hvacNoticeBanner');
    if (old) old.remove();
    if (!document.body || pageId() === 'admin') return;

    var cfg = read('hvac_notice_banner');
    if (!cfg || !cfg.enabled || !cfg.text) return;
    var pages = Array.isArray(cfg.pages) && cfg.pages.length ? cfg.pages : ['index', 'checkin', 'qna', 'quiz'];
    if (pages.indexOf(pageId()) < 0) return;

    var bannerId = String(cfg.updatedAt || cfg.text);
    var isQuizAlert = !!(cfg.isQuizAlert ||
      (cfg.linkUrl && cfg.linkUrl.indexOf('quiz.html') >= 0) ||
      (cfg.text && (cfg.text.indexOf('퀴즈') >= 0 || cfg.text.indexOf('Quiz') >= 0)));

    // 0) 체크인 전 메인 페이지(index)에서는 퀴즈 알림 팝업 배너 미표출
    if (isQuizAlert && pageId() === 'index' && !read('hvac_user_checked')) {
      return;
    }

    var now = Date.now();

    // 1) 발송 시점 기준 만료 검사 (Global Expiration):
    //    퀴즈 알림 팝업(또는 expireAfterMs 지정 배너)은 관리자 발송 후 1분(60초) 이상 경과 시 신규 접속자에게 표시 안 함
    var expireAfterMs = Number(cfg.expireAfterMs) || (isQuizAlert ? 60000 : 0);
    if (expireAfterMs > 0 && cfg.updatedAt && (now - Number(cfg.updatedAt) >= expireAfterMs)) {
      return;
    }

    // 2) 현재 브라우저 세션에서 이미 닫았거나 15초 자동 만료된 경우 재노출 방지
    var dismissKey = 'hvac_banner_dismissed';
    try {
      if (sessionStorage.getItem(dismissKey) === bannerId) return;
    } catch (e) {}

    // 3) 사용자 로컬 최초 노출 시각(First Seen) 기준 1분 만료 검사 (Per-user Expiration)
    //    '최초 알림 후 1분 후에는 접속해도 표시 안되게':
    //    localStorage에 해당 배너의 기기별 최초 노출 시각을 영구 기록
    var seenHistoryKey = 'hvac_banner_seen_history';
    var seenHistory = {};
    try {
      seenHistory = JSON.parse(localStorage.getItem(seenHistoryKey) || '{}');
    } catch (e) {
      seenHistory = {};
    }

    if (seenHistory[bannerId]) {
      var firstSeenAt = Number(seenHistory[bannerId]);
      // 최초 알림 노출 후 1분(60,000ms) 이상 경과 시, 재접속해도 표시 안 함
      if (firstSeenAt && (now - firstSeenAt >= 60000)) {
        return;
      }
    } else {
      // 이 기기에서 최초로 팝업이 노출되는 순간: 현재 시각 저장
      seenHistory[bannerId] = now;
      try {
        var histKeys = Object.keys(seenHistory);
        if (histKeys.length > 30) {
          histKeys.slice(0, histKeys.length - 30).forEach(function (k) { delete seenHistory[k]; });
        }
        localStorage.setItem(seenHistoryKey, JSON.stringify(seenHistory));
      } catch (e) {}
    }

    var st = BANNER_STYLE[cfg.level] || BANNER_STYLE.info;
    var bar = document.createElement('div');
    bar.id = 'hvacNoticeBanner';
    bar.setAttribute('role', 'status');
    bar.style.cssText = [
      'position:fixed', 'top:10px', 'left:50%', 'transform:translateX(-50%)',
      'width:calc(100% - 24px)', 'max-width:640px', 'z-index:2147482000',
      'display:flex', 'align-items:flex-start', 'gap:10px',
      'padding:12px 14px', 'border-radius:14px',
      'background:' + st.bg, 'border:1px solid ' + st.border,
      'color:#fff', 'font-size:13.5px', 'line-height:1.45', 'font-weight:700',
      'box-shadow:0 14px 40px rgba(0,0,0,0.45)', 'backdrop-filter:blur(8px)',
      'font-family:Pretendard,"Noto Sans KR","Malgun Gothic",sans-serif', 'word-break:keep-all'
    ].join(';');

    var linkHtml = '';
    if (cfg.linkUrl) {
      linkHtml = ' <a href="' + esc(cfg.linkUrl) + '" target="_blank" rel="noopener noreferrer" ' +
        'style="color:#fff;text-decoration:underline;font-weight:900;white-space:nowrap;">' +
        esc(cfg.linkLabel || '자세히 보기') + ' ↗</a>';
    }

    bar.innerHTML =
      '<span style="font-size:16px;line-height:1.2;">' + st.icon + '</span>' +
      '<div style="flex:1;">' + esc(cfg.text).replace(/\n/g, '<br>') + linkHtml + '</div>' +
      '<button type="button" aria-label="공지 닫기" style="background:rgba(0,0,0,0.22);border:0;color:#fff;' +
      'width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:13px;flex-shrink:0;">✕</button>';

    var autoDismissMs = Number(cfg.duration) || 15000; // 퀴즈 오픈 알람 배너 15초 유지
    var bannerTimer = setTimeout(function () {
      if (bar && bar.parentNode) {
        bar.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
        bar.style.opacity = '0';
        bar.style.transform = 'translateX(-50%) translateY(-20px)';
        setTimeout(function () {
          if (bar && bar.parentNode) bar.remove();
        }, 400);
      }
      // 15초 자동 경과 후 자연 소멸 시, 같은 세션 내 페이지 이동마다 재점등되는 현상 방지
      try { sessionStorage.setItem(dismissKey, bannerId); } catch (e) {}
    }, autoDismissMs);

    bar.querySelector('button').addEventListener('click', function () {
      if (bannerTimer) clearTimeout(bannerTimer);
      try {
        sessionStorage.setItem(dismissKey, bannerId);
        // 사용자가 명시적으로 닫기(✕)를 누른 경우, 즉시 1분 경과 처리로 영구 소멸
        seenHistory[bannerId] = Date.now() - 60000;
        localStorage.setItem(seenHistoryKey, JSON.stringify(seenHistory));
      } catch (e) {}
      bar.remove();
    });
    document.body.appendChild(bar);
  }

  // ---------------------------------------------------------
  // 4) 보안 열람 전용 (Read-Only DRM) 문서 뷰어 모달
  // ---------------------------------------------------------
  function toEmbedPreviewUrl(rawUrl, mode) {
    var u = String(rawUrl || '').trim();
    if (!u) return '';
    // Google Drive 공유 링크 자동 /preview 변환 (다운로드·인쇄 툴바 제거)
    var gDriveMatch = u.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (gDriveMatch && gDriveMatch[1]) {
      return 'https://drive.google.com/file/d/' + gDriveMatch[1] + '/preview';
    }
    var gDocMatch = u.match(/docs\.google\.com\/(presentation|document|spreadsheets)\/d\/([a-zA-Z0-9_-]+)/);
    if (gDocMatch && gDocMatch[2]) {
      return 'https://docs.google.com/' + gDocMatch[1] + '/d/' + gDocMatch[2] + '/preview';
    }
    if (mode === 'readonly' && /\.pdf(\?|#|$)/i.test(u) && !/#/.test(u)) {
      return u + '#toolbar=0&navpanes=0&scrollbar=1';
    }
    return u;
  }

  function getViewerWatermarkText() {
    var user = read('hvac_user_checked');
    var who = '비로그인 열람자';
    if (user && (user.name || user.email)) {
      who = (user.name || '') + ' (' + (user.checkinId || user.email || '') + ')';
    }
    var d = new Date();
    var ts = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return 'CONFIDENTIAL · ' + who + ' · ' + ts + ' · 무단 캡처·다운로드·배포 금지';
  }

  function ensureDrmStyles() {
    if (document.getElementById('hvac-drm-style')) return;
    var st = document.createElement('style');
    st.id = 'hvac-drm-style';
    st.textContent =
      '@media print { body.hvac-drm-open * { display: none !important; } body.hvac-drm-open::after { content: "🔒 보안 문서 열람 중에는 인쇄 및 PDF 저장이 금지되어 있습니다."; display:block !important; padding:40px; font-size:20px; font-weight:bold; } }\n' +
      '.hvac-drm-modal { position:fixed; inset:0; z-index:2147483600; background:rgba(3,7,5,0.94); display:flex; flex-direction:column; user-select:none; -webkit-user-select:none; }\n' +
      '.hvac-drm-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 18px; background:#07120c; border-bottom:1px solid rgba(243,196,72,0.3); color:#fff; font-family:Pretendard,sans-serif; }\n' +
      '.hvac-drm-body { position:relative; flex:1; overflow:hidden; background:#111; }\n' +
      '.hvac-drm-body.blurred iframe { filter:blur(22px) brightness(0.3); }\n' +
      '.hvac-drm-iframe { width:100%; height:100%; border:0; background:#fff; }\n' +
      '.hvac-drm-watermark { position:absolute; inset:-40%; pointer-events:none; z-index:10; display:flex; flex-wrap:wrap; align-content:space-around; justify-content:space-around; transform:rotate(-24deg); opacity:0.17; overflow:hidden; }\n' +
      '.hvac-drm-watermark span { font-size:13px; font-weight:900; color:#d9381e; text-shadow:0 0 2px #fff; padding:28px 36px; white-space:nowrap; font-family:Pretendard,sans-serif; }\n' +
      '.hvac-drm-shield { position:absolute; top:0; right:0; width:120px; height:56px; z-index:15; background:transparent; }\n' +
      '.hvac-drm-blur-notice { position:absolute; inset:0; z-index:20; display:none; align-items:center; justify-content:center; text-align:center; color:#fff; font-weight:800; font-size:16px; padding:24px; background:rgba(0,0,0,0.72); pointer-events:none; }\n' +
      '.hvac-drm-body.blurred .hvac-drm-blur-notice { display:flex; }';
    (document.head || document.documentElement).appendChild(st);
  }

  function openMaterialViewer(opts) {
    opts = opts || {};
    var url = String(opts.url || '').trim();
    if (!url) return;
    var mode = opts.mode || 'readonly'; // 'readonly' | 'download'
    var title = opts.title || '세미나 발표자료';

    if (mode === 'download') {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }

    ensureDrmStyles();
    var old = document.getElementById('hvacDrmModal');
    if (old) old.remove();

    var embedUrl = toEmbedPreviewUrl(url, 'readonly');
    var wmText = getViewerWatermarkText();
    var wmSpans = '';
    for (var i = 0; i < 48; i++) {
      wmSpans += '<span>' + esc(wmText) + '</span>';
    }

    var modal = document.createElement('div');
    modal.id = 'hvacDrmModal';
    modal.className = 'hvac-drm-modal';
    modal.innerHTML =
      '<div class="hvac-drm-head">' +
        '<div style="display:flex;align-items:center;gap:8px;min-width:0;">' +
          '<span style="background:rgba(243,196,72,0.18);border:1px solid rgba(243,196,72,0.45);color:#f3c448;font-size:11px;font-weight:800;padding:3px 8px;border-radius:99px;white-space:nowrap;">🔒 읽기 전용 보안뷰어</span>' +
          '<strong style="font-size:14.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(title) + '</strong>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">' +
          '<span style="font-size:11.5px;color:rgba(255,255,255,0.6);">다운로드·인쇄·무단캡처 제한됨</span>' +
          '<button type="button" id="btnCloseDrmModal" style="background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.25);color:#fff;padding:6px 12px;border-radius:8px;font-weight:800;font-size:12.5px;cursor:pointer;">✕ 닫기</button>' +
        '</div>' +
      '</div>' +
      '<div class="hvac-drm-body" id="hvacDrmBody">' +
        '<iframe class="hvac-drm-iframe" src="' + esc(embedUrl) + '" sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer"></iframe>' +
        '<div class="hvac-drm-shield" title="외부 팝아웃 차단"></div>' +
        '<div class="hvac-drm-watermark">' + wmSpans + '</div>' +
        '<div class="hvac-drm-blur-notice">🔒 보안 보호 작동 중<br><small style="font-weight:500;opacity:0.8;margin-top:6px;display:block;">화면 캡처 방지 및 창 전환 보호를 위해 일시 가림 처리되었습니다.<br>화면을 터치하거나 클릭하면 다시 표시됩니다.</small></div>' +
      '</div>';

    document.body.classList.add('hvac-drm-open');
    document.body.appendChild(modal);

    var bodyEl = modal.querySelector('#hvacDrmBody');
    function setBlurred(flag) {
      if (bodyEl) bodyEl.classList.toggle('blurred', !!flag);
    }

    function onKeyDown(e) {
      var k = (e.key || '').toLowerCase();
      if (e.key === 'PrintScreen' || (e.ctrlKey && (k === 'p' || k === 's' || k === 'u')) || (e.metaKey && (k === 'p' || k === 's'))) {
        e.preventDefault();
        e.stopPropagation();
        setBlurred(true);
      } else if (e.key === 'Escape') {
        closeViewer();
      }
    }
    function onKeyUp(e) {
      if (e.key === 'PrintScreen') {
        setBlurred(true);
        try { navigator.clipboard.writeText('보안 문서 열람 중에는 화면 캡처가 제한됩니다.'); } catch (err) {}
      }
    }
    function onContextMenu(e) { e.preventDefault(); }
    function onWindowBlur() { setBlurred(true); }
    function onWindowFocus() { setBlurred(false); }
    function onVisChange() { if (document.hidden) setBlurred(true); }

    modal.addEventListener('contextmenu', onContextMenu);
    modal.addEventListener('click', function () { setBlurred(false); });
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('focus', onWindowFocus);
    document.addEventListener('visibilitychange', onVisChange);

    function closeViewer() {
      document.body.classList.remove('hvac-drm-open');
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('focus', onWindowFocus);
      document.removeEventListener('visibilitychange', onVisChange);
      modal.remove();
    }
    modal.querySelector('#btnCloseDrmModal').addEventListener('click', closeViewer);
  }

  // ---------------------------------------------------------
  // 5) 배포 설정 파일(site-config.json) & 이벤트 알림
  // ---------------------------------------------------------
  function notifyUpdated(keys) {
    try {
      window.dispatchEvent(new CustomEvent('hvac:config-updated', { detail: { keys: keys || CONFIG_KEYS } }));
    } catch (e) {}
  }

  function refreshCommon() {
    applyTheme();
    applyLinks();
    renderBanner();
  }

  function applyPublishedConfig(cfg) {
    if (!cfg || !cfg.publishedAt || !cfg.data || typeof cfg.data !== 'object') return false;
    var applied = '';
    try { applied = localStorage.getItem(APPLIED_MARKER) || ''; } catch (e) {}
    if (String(cfg.publishedAt) <= applied) return false;

    var changed = [];
    Object.keys(cfg.data).forEach(function (k) {
      if (CONFIG_KEYS.indexOf(k) < 0 && k !== CLOUD_CFG_KEY) return;
      try {
        if (cfg.data[k] === null) localStorage.removeItem(k);
        else localStorage.setItem(k, JSON.stringify(cfg.data[k]));
        changed.push(k);
      } catch (e) {}
    });
    try { localStorage.setItem(APPLIED_MARKER, String(cfg.publishedAt)); } catch (e) {}
    refreshCommon();
    notifyUpdated(changed);
    return true;
  }

  function syncPublished() {
    if (location.protocol === 'file:' || !window.fetch) return Promise.resolve(false);
    return fetch(BASE + 'site-config.json?ts=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(applyPublishedConfig)
      .catch(function () { return false; });
  }

  // ---------------------------------------------------------
  // 6) Firebase Realtime Database 초경량 REST 브릿지
  //    - 영구 WebSocket 연결을 잡지 않아 200명 동시 접속 시에도
  //      무료(Spark) 플랜의 100 동시 연결 한도에 걸리지 않음
  //    - meta/updatedAt 타임스탬프(20B) 비교로 트래픽 최소화
  // ---------------------------------------------------------
  var DEFAULT_CLOUD_CONFIG = {
    enabled: true,
    dbUrl: 'https://lg-hvac-default-rtdb.asia-southeast1.firebasedatabase.app',
    roomKey: 'hvac2026'
  };

  function getCloudConfig() {
    // URL 파라미터 ?db=... 로 임시 연결 테스트 지원
    try {
      var params = new URLSearchParams(location.search);
      var paramDb = params.get('db');
      if (paramDb && /^https:\/\/[a-z0-9-]+.*\.(firebaseio\.com|firebasedatabase\.app)/i.test(paramDb)) {
        var existing = read(CLOUD_CFG_KEY) || DEFAULT_CLOUD_CONFIG;
        existing.enabled = true;
        existing.dbUrl = paramDb.replace(/\/+$/, '');
        writeLocalSilent(CLOUD_CFG_KEY, existing);
      }
    } catch (e) {}
    var cfg = read(CLOUD_CFG_KEY) || DEFAULT_CLOUD_CONFIG;
    if (!cfg || !cfg.enabled || !cfg.dbUrl) cfg = DEFAULT_CLOUD_CONFIG;
    var cleanUrl = String(cfg.dbUrl).trim().replace(/\/+$/, '');
    if (!/^https:\/\//i.test(cleanUrl)) cleanUrl = DEFAULT_CLOUD_CONFIG.dbUrl;
    return {
      enabled: true,
      dbUrl: cleanUrl,
      roomKey: (cfg.roomKey || 'hvac2026').replace(/[^a-zA-Z0-9_-]/g, '')
    };
  }

  function cloudPath(subpath) {
    var c = getCloudConfig();
    if (!c) return null;
    return c.dbUrl + '/' + c.roomKey + '/' + subpath.replace(/^\/+/, '') + '.json';
  }

  var lastSeenMeta = { config: 0, checkins: 0, qna: 0, quiz: 0, surveys: 0, games: 0 };
  var isSyncingCloud = false;

  function touchCloudMeta(section) {
    var u = cloudPath('meta/' + section);
    if (!u || !window.fetch) return Promise.resolve();
    var ts = Date.now();
    lastSeenMeta[section] = ts;
    return fetch(u, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ts)
    }).catch(function () {});
  }

  // 관리자 -> 클라우드: 설정 데이터 업로드
  function pushConfigToCloud(key, val) {
    var u = cloudPath('config/' + key);
    if (!u || !window.fetch) return Promise.resolve(false);
    return fetch(u, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(val)
    }).then(function (r) {
      if (r.ok) return touchCloudMeta('config').then(function () { return true; });
      return false;
    }).catch(function () { return false; });
  }

  function pushAllConfigsToCloud() {
    var c = getCloudConfig();
    if (!c || !window.fetch) return Promise.resolve(false);
    var payload = {};
    CONFIG_KEYS.forEach(function (k) {
      var v = read(k);
      if (v !== null) payload[k] = v;
    });
    return fetch(cloudPath('config'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (r.ok) return touchCloudMeta('config').then(function () { return true; });
      return false;
    }).catch(function () { return false; });
  }

  // ---------------------------------------------------------
  // 6-1) 기기 식별 & 세션 토큰 & 운영진 식별 헬퍼
  // ---------------------------------------------------------
  function getDeviceId() {
    var did = '';
    try { did = localStorage.getItem('hvac_device_id') || ''; } catch (e) {}
    if (!did) {
      did = 'dev_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
      try { localStorage.setItem('hvac_device_id', did); } catch (e) {}
    }
    return did;
  }

  function getDeviceType() {
    var ua = (navigator.userAgent || '').toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) return '📱 iPhone';
    if (/android/.test(ua)) return '📱 Android';
    if (/windows/.test(ua)) return '💻 Windows PC';
    if (/macintosh|mac os/.test(ua)) return '💻 Mac';
    return '📱 Mobile';
  }

  var DEFAULT_OPERATORS = [
    { email: 'hvac.admin', name: '세미나운영진', role: 'admin', position: '운영팀' },
    { email: 'youngsoo.lee', name: '이영수', role: 'admin', position: '운영총괄' }
  ];

  function getOperatorList() {
    var list = read('hvac_operator_list');
    if (Array.isArray(list) && list.length) return list;
    return DEFAULT_OPERATORS;
  }

  function saveOperatorList(newList) {
    if (Array.isArray(newList)) {
      writeLocalSilent('hvac_operator_list', newList);
      var c = getCloudConfig();
      if (c && window.fetch) {
        fetch(cloudPath('operators'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newList)
        }).then(function () { touchCloudMeta('config'); }).catch(function () {});
      }
    }
  }

  function isOperatorEmail(email) {
    if (!email) return false;
    var clean = String(email).trim().toLowerCase().replace('@lge.com', '');
    var ops = getOperatorList();
    return ops.some(function (o) {
      var opClean = String(o.email || '').trim().toLowerCase().replace('@lge.com', '');
      return opClean === clean;
    });
  }

  var DEFAULT_MILESTONES = [
    { seq: 1, prize: '스타벅스 커피 쿠폰 (1호 체크인)' },
    { seq: 7, prize: '스타벅스 커피 쿠폰 (럭키 7)' },
    { seq: 10, prize: '스타벅스 커피 쿠폰 (10번째 체크인)' },
    { seq: 77, prize: '스타벅스 커피 쿠폰 (행운의 77번째)' },
    { seq: 100, prize: '스타벅스 커피 쿠폰 (센추리 100번째)' }
  ];


  // =========================================================
  // 만족도 설문(Survey) 기본 설정 및 클라우드 연동 엔진
  // =========================================================
  var DEFAULT_SURVEY_CONFIG = {
    title: "2026 HVAC Engineering Expert Seminar 만족도 설문",
    subtitle: "참석해 주신 여러분의 소중한 피드백은 차기 세미나 기획 및 기술 프로그램 개선에 큰 힘이 됩니다.",
    pages: [
      {
        pageId: "partA1",
        pageTitle: "A. 교육과정에 대한 만족도",
        pageSub: "전반적인 세미나와 운영 인프라에 대한 만족도를 평가해 주세요.",
        questions: [
          {
            id: "q0",
            category: "general",
            type: "rating",
            max: 5,
            required: true,
            label: "0. 전반적인 세미나 구성과 진행에 만족하십니까?"
          },
          {
            id: "q1",
            category: "infra",
            type: "rating",
            max: 5,
            required: true,
            label: "1. 세미나 운영 및 시설 등 인프라에 만족하십니까?"
          }
        ]
      },
      {
        pageId: "partA2",
        pageTitle: "[ 과정별 만족도 ]",
        pageSub: "오늘 진행된 각 세션 발표 내용의 유익성과 완성도를 평가해 주세요.",
        questions: [
          {
            id: "q2",
            category: "session",
            type: "rating",
            max: 5,
            required: true,
            label: "2. 국내주거난방의 변천과 현황 - 여명석 교수"
          },
          {
            id: "q3",
            category: "session",
            type: "rating",
            max: 5,
            required: true,
            label: "3. 고밀도 AI 서버의 액체냉각 및 데이터센터 열관리 기술 - 이성혁 교수"
          },
          {
            id: "q4",
            category: "session",
            type: "rating",
            max: 5,
            required: true,
            label: "4. 국내 전력시장 현황 및 AIDC 전력공급 방안 - 조홍종 교수"
          },
          {
            id: "q5",
            category: "session",
            type: "rating",
            max: 5,
            required: true,
            label: "5. 헬로우 히트펌프, 굿바이 보일러 - 유정현 수석 연구원"
          },
          {
            id: "q6",
            category: "session",
            type: "rating",
            max: 5,
            required: true,
            label: "6. 에너지컨설팅 사례 발표 - 오영훈 팀장"
          },
          {
            id: "q7",
            category: "session",
            type: "rating",
            max: 5,
            required: true,
            label: "7. 테라포밍 또는 찬란한 멸종 - 그래도 우리는 지구에 살아야 한다 - 이정모 관장"
          }
        ]
      },
      {
        pageId: "partB",
        pageTitle: "B. 교육과정에 대한 자유의견/건의사항",
        pageSub: "향후 세미나 발전을 위한 소중한 의견을 자유롭게 남겨주세요.",
        questions: [
          {
            id: "q8",
            category: "feedback",
            type: "text",
            required: false,
            label: "8. 교육과정에서 좋았던 점",
            placeholder: "답변을 입력하세요."
          },
          {
            id: "q9",
            category: "feedback",
            type: "text",
            required: false,
            label: "9. 교육과정에서 개선할 점",
            placeholder: "답변을 입력하세요."
          },
          {
            id: "q10",
            category: "feedback",
            type: "text",
            required: false,
            label: "10. 향후 듣고 싶은 주제 (기술 특강)",
            placeholder: "답변을 입력하세요."
          },
          {
            id: "q11",
            category: "feedback",
            type: "text",
            required: false,
            label: "11. 향후 듣고 싶은 주제 (인문/ 경제 특강)",
            placeholder: "답변을 입력하세요."
          }
        ]
      }
    ]
  };

  function getSurveyConfig() {
    var saved = read('hvac_survey_config');
    if (saved && saved.pages && saved.pages.length) return saved;
    return DEFAULT_SURVEY_CONFIG;
  }

  function saveSurveyConfig(newCfg) {
    if (!newCfg || typeof newCfg !== 'object') return;
    writeLocalSilent('hvac_survey_config', newCfg);
    var c = getCloudConfig();
    if (c && window.fetch) {
      fetch(cloudPath('config/hvac_survey_config'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCfg)
      }).then(function () {
        touchCloudMeta('config');
      }).catch(function () {});
    }
    notifyUpdated(['hvac_survey_config']);
  }

  var DEFAULT_GAME_CONFIG = {
    enabled: false,
    lockMessage: '점심시간 미니게임은 12:30 오찬 시간에 맞춰 공식 오픈됩니다. 잠시 후 참여해 주세요!',
    openedAt: null,
    resetAt: 0,
    stopwatchBlindSec: 3,
    tempTarget: 20.0,
    tempSeason: 'winter',
    maxTries: 3
  };

  function getGameConfig() {
    var saved = read('hvac_game_config');
    if (!saved) return DEFAULT_GAME_CONFIG;
    return Object.assign({}, DEFAULT_GAME_CONFIG, saved);
  }

  function saveGameConfig(newCfg) {
    if (!newCfg || typeof newCfg !== 'object') return;
    var current = getGameConfig();
    var merged = Object.assign({}, current, newCfg);
    writeLocalSilent('hvac_game_config', merged);
    var c = getCloudConfig();
    if (c && window.fetch) {
      fetch(cloudPath('config/hvac_game_config'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged)
      }).then(function () {
        touchCloudMeta('config');
      }).catch(function () {});
    }
    notifyUpdated(['hvac_game_config']);
    return merged;
  }

  function pushSurveyResponseToCloud(surveyData) {
    var c = getCloudConfig();
    if (!c || !window.fetch || !surveyData) return Promise.resolve(false);
    var emailKey = String(surveyData.email || 'anon_' + Date.now()).toLowerCase().replace('@lge.com', '').replace(/[.#$\[\]\/]/g, '_');
    var url = cloudPath('surveys/' + emailKey);
    return fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(surveyData)
    }).then(function (r) {
      if (r.ok) {
        touchCloudMeta('surveys');
        return true;
      }
      return false;
    }).catch(function () { return false; });
  }

  // 참석자 체크인: ETag 기반 원자적 순번(1~200+) 발급 및 클라우드 등록 (단일 세션 & 운영진 이월 지원)
  
  // =========================================================
  // 🎁 출석 선물 수령 불변 레지스트리 (Immutable Gift Registry)
  // 관리자 초기화/리셋 시에도 삭제되지 않는 영구 보존 이력
  // =========================================================
  var GIFT_REGISTRY_KEY = 'hvac_gift_registry';

  function getLocalGiftRegistry() {
    try {
      return JSON.parse(localStorage.getItem(GIFT_REGISTRY_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }

  function saveLocalGiftToRegistry(cleanEmail, giftInfo) {
    var reg = getLocalGiftRegistry();
    cleanEmail = String(cleanEmail || '').toLowerCase().replace('@lge.com', '').replace(/[.#$\[\]\/]/g, '_');
    reg[cleanEmail] = Object.assign({}, reg[cleanEmail] || {}, giftInfo, {
      cleanEmail: cleanEmail,
      updatedAt: Date.now()
    });
    try {
      localStorage.setItem(GIFT_REGISTRY_KEY, JSON.stringify(reg));
    } catch (e) {}
    return reg[cleanEmail];
  }

  function syncGiftToLocalCheckins(cleanEmail, giftStatus, giftReceivedAt) {
    try {
      var list = JSON.parse(localStorage.getItem('hvac_checkin_list') || '[]');
      var updated = false;
      list.forEach(function (att) {
        var k = String(att.email || '').toLowerCase().replace('@lge.com', '').replace(/[.#$\[\]\/]/g, '_');
        if (k === cleanEmail) {
          att.giftStatus = giftStatus;
          att.giftReceivedAt = giftReceivedAt;
          updated = true;
        }
      });
      if (updated) {
        localStorage.setItem('hvac_checkin_list', JSON.stringify(list));
      }
      var user = JSON.parse(localStorage.getItem('hvac_user_checked') || 'null');
      if (user) {
        var uk = String(user.email || '').toLowerCase().replace('@lge.com', '').replace(/[.#$\[\]\/]/g, '_');
        if (uk === cleanEmail) {
          user.giftStatus = giftStatus;
          user.giftReceivedAt = giftReceivedAt;
          localStorage.setItem('hvac_user_checked', JSON.stringify(user));
        }
      }
    } catch (e) {}
  }

  // 실시간 선물 수령 상태 확인 (클라우드 & 로컬 동시)
  function cloudGetGiftStatus(cleanEmail) {
    cleanEmail = String(cleanEmail || '').toLowerCase().replace('@lge.com', '').replace(/[.#$\[\]\/]/g, '_');
    var localReg = getLocalGiftRegistry();
    var localRecord = localReg[cleanEmail] || null;

    var c = getCloudConfig();
    if (!c || !window.fetch) {
      return Promise.resolve(localRecord || { giftStatus: 'unclaimed', giftReceivedAt: null });
    }

    return fetch(cloudPath('gift_receipts/' + cleanEmail), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (remote) {
        if (remote && (remote.giftStatus === 'received' || remote.giftStatus === 'vip')) {
          saveLocalGiftToRegistry(cleanEmail, remote);
          syncGiftToLocalCheckins(cleanEmail, remote.giftStatus, remote.giftReceivedAt);
          return remote;
        }
        return fetch(cloudPath('checkins/items/' + cleanEmail), { cache: 'no-store' })
          .then(function (r2) { return r2.ok ? r2.json() : null; })
          .then(function (item) {
            if (item && (item.giftStatus === 'received' || item.giftStatus === 'vip')) {
              var rec = {
                giftStatus: item.giftStatus,
                giftReceivedAt: item.giftReceivedAt,
                cleanEmail: cleanEmail
              };
              saveLocalGiftToRegistry(cleanEmail, rec);
              syncGiftToLocalCheckins(cleanEmail, item.giftStatus, item.giftReceivedAt);
              return rec;
            }
            return localRecord || { giftStatus: 'unclaimed', giftReceivedAt: null };
          });
      })
      .catch(function () {
        return localRecord || { giftStatus: 'unclaimed', giftReceivedAt: null };
      });
  }

  // 🎁 선물 수령 확인 트랜잭션 (다중 기기 동시 수령 원천 차단)
  function cloudVerifyAndClaimGift(cleanEmail, targetStatus, meta) {
    cleanEmail = String(cleanEmail || '').toLowerCase().replace('@lge.com', '').replace(/[.#$\[\]\/]/g, '_');
    targetStatus = (targetStatus === 'vip') ? 'vip' : 'received';
    meta = meta || {};

    var padZero = function (n) { return String(n).padStart(2, '0'); };
    var now = new Date();
    var nowTimeStr = now.getFullYear() + '-' + padZero(now.getMonth() + 1) + '-' + padZero(now.getDate()) + ' ' +
                     padZero(now.getHours()) + ':' + padZero(now.getMinutes()) + ':' + padZero(now.getSeconds());

    var c = getCloudConfig();

    // 로컬 검증
    var localReg = getLocalGiftRegistry();
    var localRecord = localReg[cleanEmail];
    if (localRecord && (localRecord.giftStatus === 'received' || localRecord.giftStatus === 'vip')) {
      return Promise.resolve({
        success: false,
        alreadyClaimed: true,
        giftStatus: localRecord.giftStatus,
        giftReceivedAt: localRecord.giftReceivedAt
      });
    }

    if (!c || !window.fetch) {
      var saved = saveLocalGiftToRegistry(cleanEmail, {
        giftStatus: targetStatus,
        giftReceivedAt: nowTimeStr,
        claimedAt: Date.now(),
        meta: meta
      });
      syncGiftToLocalCheckins(cleanEmail, targetStatus, nowTimeStr);
      return Promise.resolve({
        success: true,
        alreadyClaimed: false,
        giftStatus: targetStatus,
        giftReceivedAt: nowTimeStr
      });
    }

    var receiptUrl = cloudPath('gift_receipts/' + cleanEmail);
    var itemUrl = cloudPath('checkins/items/' + cleanEmail);

    return fetch(receiptUrl, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (remote) {
        if (remote && (remote.giftStatus === 'received' || remote.giftStatus === 'vip')) {
          saveLocalGiftToRegistry(cleanEmail, remote);
          syncGiftToLocalCheckins(cleanEmail, remote.giftStatus, remote.giftReceivedAt);
          return {
            success: false,
            alreadyClaimed: true,
            giftStatus: remote.giftStatus,
            giftReceivedAt: remote.giftReceivedAt
          };
        }

        var newReceipt = {
          cleanEmail: cleanEmail,
          giftStatus: targetStatus,
          giftReceivedAt: nowTimeStr,
          claimedAt: Date.now(),
          meta: meta
        };

        return fetch(receiptUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newReceipt)
        }).then(function () {
          return fetch(itemUrl, { cache: 'no-store' })
            .then(function (r2) { return r2.ok ? r2.json() : null; })
            .then(function (checkinItem) {
              if (checkinItem) {
                checkinItem.giftStatus = targetStatus;
                checkinItem.giftReceivedAt = nowTimeStr;
                return fetch(itemUrl, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(checkinItem)
                });
              }
            }).catch(function () {});
        }).then(function () {
          saveLocalGiftToRegistry(cleanEmail, newReceipt);
          syncGiftToLocalCheckins(cleanEmail, targetStatus, nowTimeStr);
          touchCloudMeta('checkins');
          return {
            success: true,
            alreadyClaimed: false,
            giftStatus: targetStatus,
            giftReceivedAt: nowTimeStr
          };
        });
      })
      .catch(function (err) {
        var saved = saveLocalGiftToRegistry(cleanEmail, {
          giftStatus: targetStatus,
          giftReceivedAt: nowTimeStr,
          claimedAt: Date.now(),
          meta: meta
        });
        syncGiftToLocalCheckins(cleanEmail, targetStatus, nowTimeStr);
        return {
          success: true,
          alreadyClaimed: false,
          giftStatus: targetStatus,
          giftReceivedAt: nowTimeStr
        };
      });
  }

  function cloudCheckin(attendee) {
    var c = getCloudConfig();
    if (!c || !window.fetch) return Promise.resolve(null);

    var cleanEmail = String(attendee.email || '').toLowerCase().replace('@lge.com', '').replace(/[.#$\[\]\/]/g, '_');
    var existingUrl = cloudPath('checkins/items/' + cleanEmail);
    var isOp = isOperatorEmail(cleanEmail) || !!attendee.isOperator;
    var newSessionToken = 'tok_' + getDeviceId() + '_' + Date.now();

    // 카테고리 결정: 운영진(300번대) / 외부(500번대) / VIP(700번대) / 사전등록,현장(1번대)
    var cat = attendee.category;
    if (!cat) {
      if (isOp || attendee.type === 'operator') cat = 'operator';
      else if (String(attendee.dept || '').includes('사외') || String(attendee.position || '').includes('강사') || String(attendee.position || '').includes('교수') || String(attendee.dept || '').includes('외부')) cat = 'external';
      else if (String(attendee.dept || '').includes('VIP') || String(attendee.position || '').includes('초대')) cat = 'vip';
      else if (attendee.type === 'pre' || attendee.type === 'matched') cat = 'pre';
      else cat = 'walkin';
    }

    // 1) 이미 체크인한 사용자인지 먼저 확인 (재접속 시 기존 순번 유지 & 활성 세션 토큰 갱신)
    return fetch(existingUrl, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (existing) {
        if (existing && existing.seq) {
          var updated = Object.assign({}, existing, attendee, {
            seq: existing.seq,
            checkinId: existing.checkinId || ('HVAC-' + String(existing.seq).padStart(3, '0')),
            category: existing.category || cat,
            isOperator: isOp,
            type: isOp ? 'operator' : (existing.type || 'walkin'),
            sessionToken: newSessionToken,
            activeDeviceId: getDeviceId(),
            activeDeviceType: getDeviceType(),
            lastActiveAt: Date.now(),
            isMilestoneWinner: !!existing.isMilestoneWinner,
            milestonePrize: existing.milestonePrize || ''
          });
          return fetch(existingUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updated)
          }).then(function () {
            touchCloudMeta('checkins');
            return updated;
          });
        }

        // 2) 신규 체크인: 대역별(1~299, 301~499, 501~699, 701~899) ETag CAS 트랜잭션으로 원자적 순번 증가
        var baseOffset = 0;
        var counterSubPath = 'checkins/seqCounter';
        if (cat === 'operator') {
          baseOffset = 300;
          counterSubPath = 'checkins/seqCounter_operator';
        } else if (cat === 'external') {
          baseOffset = 500;
          counterSubPath = 'checkins/seqCounter_external';
        } else if (cat === 'vip') {
          baseOffset = 700;
          counterSubPath = 'checkins/seqCounter_vip';
        }

        var counterUrl = cloudPath(counterSubPath);
        function allocateSeq(attempt) {
          return fetch(counterUrl, { headers: { 'X-Firebase-ETag': 'true' }, cache: 'no-store' })
            .then(function (res) {
              var etag = res.headers.get('ETag');
              return res.json().then(function (curVal) {
                var nextSeq = (typeof curVal === 'number' && curVal >= baseOffset ? curVal : baseOffset) + 1;
                var putHeaders = { 'Content-Type': 'application/json' };
                if (etag) putHeaders['If-Match'] = etag;
                return fetch(counterUrl, {
                  method: 'PUT',
                  headers: putHeaders,
                  body: JSON.stringify(nextSeq)
                }).then(function (putRes) {
                  if (putRes.status === 412 && attempt < 6) {
                    return allocateSeq(attempt + 1);
                  }
                  return nextSeq;
                });
              });
            });
        }

        return allocateSeq(0).then(function (seq) {
          var milestones = read('hvac_milestone_events') || DEFAULT_MILESTONES;
          var deferredUrl = cloudPath('checkins/deferredMilestones');

          return fetch(deferredUrl, { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : {}; })
            .catch(function () { return {}; })
            .then(function (defMap) {
              defMap = defMap || {};
              var matched = milestones.find(function (m) { return parseInt(m.seq, 10) === seq; });
              var matchedPrize = matched ? matched.prize : (defMap[seq] || '');

              var isWinner = false;
              var finalPrize = '';

              if (matchedPrize) {
                if (isOp) {
                  // 운영진은 당첨 제외! 다음 일반 참석자(seq + 1)에게 이월
                  isWinner = false;
                  finalPrize = '';
                  defMap[seq + 1] = matchedPrize;
                  if (defMap[seq]) delete defMap[seq];
                  fetch(deferredUrl, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(defMap)
                  }).catch(function () {});
                } else {
                  // 일반 참석자 정정 당첨!
                  isWinner = true;
                  finalPrize = matchedPrize;
                  if (defMap[seq]) {
                    delete defMap[seq];
                    fetch(deferredUrl, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(defMap)
                    }).catch(function () {});
                  }
                }
              }

              // 사전 등록 명부 검색
              var roster = read('hvac_roster_list') || [];
              var rosterMatch = roster.find(function (r) {
                return String(r.email || '').toLowerCase().replace('@lge.com', '').trim() === cleanEmail;
              });

              var checkinType = isOp ? 'operator' : (rosterMatch ? 'pre_registered' : (attendee.type || 'walkin'));
              var position = attendee.position || (rosterMatch ? (rosterMatch.position || rosterMatch.title || '') : '');
              var dept = attendee.dept || (rosterMatch ? (rosterMatch.dept || '') : '');
              var empNo = attendee.empNo || (rosterMatch ? (rosterMatch.empNo || '') : '');

              var record = Object.assign({}, attendee, {
                seq: seq,
                checkinId: 'HVAC-' + String(seq).padStart(3, '0'),
                cleanEmail: cleanEmail,
                isOperator: isOp,
                type: checkinType,
                position: position,
                dept: dept,
                empNo: empNo,
                sessionToken: newSessionToken,
                activeDeviceId: getDeviceId(),
                activeDeviceType: getDeviceType(),
                lastActiveAt: Date.now(),
                isMilestoneWinner: isWinner,
                milestonePrize: finalPrize
              });

              return fetch(existingUrl, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(record)
              }).then(function () {
                touchCloudMeta('checkins');
                return record;
              });
            });
        });
      })
      .catch(function () { return null; });
  }

  // 출석 목록 전체 클라우드 동기화 (관리자 수정/초기화 시)
  function pushCheckinListToCloud(list, blocked) {
    var c = getCloudConfig();
    if (!c || !window.fetch) return Promise.resolve(false);
    var itemsMap = {};
    var maxSeq = 0;
    (list || []).forEach(function (item) {
      var k = String(item.email || ('u_' + item.seq)).toLowerCase().replace('@lge.com', '').replace(/[.#$\[\]\/]/g, '_');
      itemsMap[k] = item;
      if (item.seq && item.seq > maxSeq) maxSeq = Number(item.seq);
    });
    var body = { items: itemsMap, seqCounter: maxSeq };
    if (Array.isArray(blocked)) body.blocked = blocked;
    return fetch(cloudPath('checkins'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (r.ok) return touchCloudMeta('checkins').then(function () { return true; });
      return false;
    }).catch(function () { return false; });
  }

  // Q&A 질문 목록 클라우드 동기화
  function pushQnaListToCloud(qList) {
    var c = getCloudConfig();
    if (!c || !window.fetch) return Promise.resolve(false);
    return fetch(cloudPath('qna/list'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(qList || [])
    }).then(function (r) {
      if (r.ok) return touchCloudMeta('qna').then(function () { return true; });
      return false;
    }).catch(function () { return false; });
  }

  // 퀴즈 점수 클라우드 전송 (다중 기기 동시 제출 잠금 & 최초 제출자 First-Write-Wins 보장)
  function pushQuizScoreToCloud(scoreObj) {
    var c = getCloudConfig();
    if (!c || !window.fetch || !scoreObj) return Promise.resolve({ success: false });
    var user = read('hvac_user_checked') || {};
    var key = String(user.email || scoreObj.deviceId || 'anon_' + Date.now()).toLowerCase().replace('@lge.com', '').replace(/[.#$\[\]\/]/g, '_');
    var subUrl = cloudPath('quiz/submissions/' + key);

    return fetch(subUrl, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (existing) {
        var myDeviceId = getDeviceId();
        // 2대 이상 기기에서 거의 동시 제출 시 2번째 제출 무시 (최초 1차 제출 성적 유지)
        if (existing && existing.isLocked && existing.deviceId && existing.deviceId !== myDeviceId) {
          return { duplicate: true, locked: true, originalScore: existing.score };
        }
        var record = {
          email: user.email || '미체크인(현장참석자)',
          name: user.name || '미체크인 참가자',
          position: user.position || user.title || '',
          empNo: user.empNo || user.employeeId || '',
          dept: user.dept || '',
          seq: user.seq || null,
          checkinId: user.checkinId || '-',
          score: scoreObj.score || 0,
          answeredCount: scoreObj.answeredCount || 0,
          firstTryCount: scoreObj.firstTryCount || 0,
          retryCount: scoreObj.retryCount || 0,
          total: scoreObj.total || 6,
          deviceId: myDeviceId,
          isLocked: (scoreObj.answeredCount >= (scoreObj.total || 6)),
          updatedAt: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
        };
        return fetch(subUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record)
        }).then(function (r) {
          if (r.ok) return touchCloudMeta('quiz').then(function () { return { success: true, record: record }; });
          return { success: false };
        });
      })
      .catch(function () { return { success: false }; });
  }

  // 점심 미니게임 (10초 / 26℃) 결과 클라우드 전송
  function pushGameRecordToCloud(gameData) {
    var c = getCloudConfig();
    if (!c || !window.fetch || !gameData) return Promise.resolve({ success: false });
    var user = read('hvac_user_checked') || {};
    var rawKey = user.email || gameData.email || gameData.deviceId || ('anon_' + (gameData.name || 'player') + '_' + (gameData.phoneLast4 || '0000'));
    var key = String(rawKey).toLowerCase().replace('@lge.com', '').replace(/[.#$\[\]\/]/g, '_');
    var subUrl = cloudPath('games/submissions/' + key);

    return fetch(subUrl, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (existing) {
        existing = existing || {};
        var merged = {
          key: key,
          email: user.email || gameData.email || '미체크인',
          name: gameData.name || user.name || '참가자',
          dept: gameData.dept || user.dept || '',
          phoneLast4: gameData.phoneLast4 || user.phoneLast4 || '',
          checkinId: user.checkinId || '-',
          seq: user.seq || null,
          game10s: gameData.game10s !== undefined ? gameData.game10s : (existing.game10s || { tries: [], bestTime: null, bestDiff: null, isPerfect: false }),
          game26c: gameData.game26c !== undefined ? gameData.game26c : (existing.game26c || { tries: [], bestTemp: null, bestDiff: null, isPerfect: false }),
          updatedAt: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        };
        return fetch(subUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(merged)
        }).then(function (r) {
          if (r.ok) return touchCloudMeta('games').then(function () { return { success: true, record: merged }; });
          return { success: false };
        });
      })
      .catch(function () { return { success: false }; });
  }

  function fetchGameSubmissionsFromCloud() {
    var c = getCloudConfig();
    if (!c || !window.fetch) return Promise.resolve([]);
    return fetch(cloudPath('games/submissions'), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (subMap) {
        if (!subMap || typeof subMap !== 'object') return [];
        var list = Object.values(subMap).filter(Boolean);
        writeLocalSilent('hvac_game_submissions', list);
        return list;
      })
      .catch(function () { return []; });
  }

  function resetGameSubmissionsOnCloud() {
    var c = getCloudConfig();
    if (!c || !window.fetch) return Promise.resolve(false);
    return fetch(cloudPath('games/submissions'), {
      method: 'DELETE'
    }).then(function (r) {
      if (r.ok) {
        writeLocalSilent('hvac_game_submissions', []);
        return touchCloudMeta('games').then(function () { return true; });
      }
      return false;
    }).catch(function () { return false; });
  }

  // 클라우드 -> 로컬 변경사항 폴링 (meta 타임스탬프 비교 후 변경된 섹션만 다운로드)
  function pollCloudChanges(forceAll) {
    var c = getCloudConfig();
    if (!c || !window.fetch || isSyncingCloud || document.hidden) return Promise.resolve(false);
    isSyncingCloud = true;

    return fetch(cloudPath('meta'), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (meta) {
        if (!meta || typeof meta !== 'object') {
          isSyncingCloud = false;
          return false;
        }
        var tasks = [];
        var pId = pageId();

        // 1) 설정(config) 변경 감지
        if (forceAll || (meta.config && meta.config > lastSeenMeta.config)) {
          lastSeenMeta.config = meta.config || Date.now();
          tasks.push(
            fetch(cloudPath('config'), { cache: 'no-store' })
              .then(function (r) { return r.ok ? r.json() : null; })
              .then(function (cfgData) {
                if (!cfgData || typeof cfgData !== 'object') return;
                var changedKeys = [];
                CONFIG_KEYS.forEach(function (k) {
                  if (cfgData[k] !== undefined) {
                    writeLocalSilent(k, cfgData[k]);
                    changedKeys.push(k);
                  }
                });
                if (changedKeys.length) {
                  refreshCommon();
                  notifyUpdated(changedKeys);
                }
              })
          );
        }

        // 2) Q&A 변경 감지 (qna, admin, checkin 페이지에서 동기화)
        if ((pId === 'qna' || pId === 'admin') && (forceAll || (meta.qna && meta.qna > lastSeenMeta.qna))) {
          lastSeenMeta.qna = meta.qna || Date.now();
          tasks.push(
            fetch(cloudPath('qna/list'), { cache: 'no-store' })
              .then(function (r) { return r.ok ? r.json() : null; })
              .then(function (remoteQna) {
                if (!Array.isArray(remoteQna)) return;
                // 로컬 공감(isLiked) 표시 유지 및 신규 등록 질문 보존 병합
                var localQna = read('hvac_qna_list') || [];
                var likedMap = {};
                var remoteIds = {};
                remoteQna.forEach(function (q) { if (q && q.id) remoteIds[q.id] = true; });
                localQna.forEach(function (q) { if (q && q.isLiked) likedMap[q.id] = true; });
                remoteQna.forEach(function (q) { if (q && likedMap[q.id]) q.isLiked = true; });
                var nowTs = Date.now();
                localQna.forEach(function (lq) {
                  if (lq && lq.id && !remoteIds[lq.id] && (nowTs - lq.id < 30000)) {
                    remoteQna.unshift(lq);
                  }
                });
                writeLocalSilent('hvac_qna_list', remoteQna);
                window.dispatchEvent(new StorageEvent('storage', { key: 'hvac_qna_list' }));
              })
          );
        }

        // 3) 출석 명부 변경 감지 (admin 및 checkin 차단 확인용)
        if ((pId === 'admin' || pId === 'checkin' || pId === 'attendance-dashboard') && (forceAll || (meta.checkins && meta.checkins > lastSeenMeta.checkins))) {
          lastSeenMeta.checkins = meta.checkins || Date.now();
          tasks.push(
            fetch(cloudPath('checkins'), { cache: 'no-store' })
              .then(function (r) { return r.ok ? r.json() : null; })
              .then(function (chkData) {
                if (!chkData || typeof chkData !== 'object') return;
                if (chkData.items && typeof chkData.items === 'object') {
                  var arr = Object.values(chkData.items).filter(Boolean);
                  arr.sort(function (a, b) { return (b.seq || 0) - (a.seq || 0); });
                  writeLocalSilent('hvac_checkin_list', arr);
                  window.dispatchEvent(new StorageEvent('storage', { key: 'hvac_checkin_list' }));

                  // 단일 기기 세션 검증: 다른 기기에서 새로 로그인한 경우 현재 기기 자동 로그아웃
                  var myUser = read('hvac_user_checked');
                  if (myUser && myUser.email) {
                    var myClean = String(myUser.email).toLowerCase().replace('@lge.com', '').replace(/[.#$\[\]\/]/g, '_');
                    var serverUser = chkData.items[myClean];
                    if (serverUser && serverUser.sessionToken && myUser.sessionToken && serverUser.sessionToken !== myUser.sessionToken) {
                      writeLocalSilent('hvac_user_checked', null);
                      window.dispatchEvent(new CustomEvent('hvac:session-terminated', {
                        detail: {
                          deviceType: serverUser.activeDeviceType || '다른 기기',
                          terminatedAt: serverUser.lastActiveAt || Date.now()
                        }
                      }));
                    }
                  }
                }
                if (Array.isArray(chkData.blocked)) {
                  writeLocalSilent('hvac_blocked_users', chkData.blocked);
                }
              })
          );
        }

        // 4) 퀴즈 제출 현황 변경 감지 (admin 전용)
        if (pId === 'admin' && (forceAll || (meta.quiz && meta.quiz > lastSeenMeta.quiz))) {
          lastSeenMeta.quiz = meta.quiz || Date.now();
          tasks.push(
            fetch(cloudPath('quiz/submissions'), { cache: 'no-store' })
              .then(function (r) { return r.ok ? r.json() : null; })
              .then(function (subMap) {
                if (!subMap || typeof subMap !== 'object') return;
                var list = Object.values(subMap).filter(Boolean);
                writeLocalSilent('hvac_quiz_submissions', list);
                window.dispatchEvent(new StorageEvent('storage', { key: 'hvac_quiz_submissions' }));
              })
          );
        }

        // 5) 만족도 설문(survey) 응답 변경 감지 (admin 전용)
        if (pId === 'admin' && (forceAll || (meta.surveys && meta.surveys > lastSeenMeta.surveys))) {
          lastSeenMeta.surveys = meta.surveys || Date.now();
          tasks.push(
            fetch(cloudPath('surveys'), { cache: 'no-store' })
              .then(function (r) { return r.ok ? r.json() : null; })
              .then(function (survMap) {
                if (!survMap || typeof survMap !== 'object') return;
                var list = Object.values(survMap).filter(Boolean);
                writeLocalSilent('hvac_survey_responses', list);
                window.dispatchEvent(new StorageEvent('storage', { key: 'hvac_survey_responses' }));
              })
          );
        }

        // 6) 점심 미니게임 변경 감지 (admin, lunch-screen, game)
        if ((pId === 'admin' || pId === 'lunch-screen' || pId === 'game-leaderboard' || pId === 'game') && (forceAll || (meta.games && meta.games > lastSeenMeta.games))) {
          lastSeenMeta.games = meta.games || Date.now();
          tasks.push(
            fetch(cloudPath('games/submissions'), { cache: 'no-store' })
              .then(function (r) { return r.ok ? r.json() : null; })
              .then(function (subMap) {
                if (!subMap || typeof subMap !== 'object') return;
                var list = Object.values(subMap).filter(Boolean);
                writeLocalSilent('hvac_game_submissions', list);
                window.dispatchEvent(new CustomEvent('hvac:games-updated', { detail: { submissions: list } }));
                window.dispatchEvent(new StorageEvent('storage', { key: 'hvac_game_submissions' }));
              })
              .catch(function () {})
          );
        }

        return Promise.all(tasks).then(function () {
          isSyncingCloud = false;
          return true;
        });
      })
      .catch(function () {
        isSyncingCloud = false;
        return false;
      });
  }

  // localStorage.setItem 후킹: 기존 페이지 코드가 localStorage에 쓸 때 클라우드로 자동 전파
  var origSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    origSetItem.call(this, key, value);
    if (this !== window.localStorage || isSyncingCloud) return;
    var c = getCloudConfig();
    if (!c) return;
    try {
      if (CONFIG_KEYS.indexOf(key) >= 0 && pageId() === 'admin') {
        pushConfigToCloud(key, JSON.parse(value));
      } else if (key === 'hvac_qna_list') {
        pushQnaListToCloud(JSON.parse(value));
      } else if (key === 'hvac_checkin_list' && pageId() === 'admin') {
        pushCheckinListToCloud(JSON.parse(value), read('hvac_blocked_users'));
      } else if (key === 'hvac_blocked_users' && pageId() === 'admin') {
        pushCheckinListToCloud(read('hvac_checkin_list'), JSON.parse(value));
      }
    } catch (e) {}
  };

  // 주기적 스마트 폴링 시작 (관리자/Q&A는 4초, 일반 페이지는 8초)
  var pollTimer = null;
  function startCloudLoop() {
    if (pollTimer) clearInterval(pollTimer);
    if (!getCloudConfig()) return;
    pollCloudChanges(true);
    var intervalMs = (pageId() === 'admin' || pageId() === 'qna' || pageId() === 'attendance-dashboard') ? 3000 : 8000;
    pollTimer = setInterval(function () {
      pollCloudChanges(false);
    }, intervalMs);
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && getCloudConfig()) {
      pollCloudChanges(false);
    }
  });

  // ---------------------------------------------------------
  // 부트스트랩
  // ---------------------------------------------------------
  applyTheme();

  function onReady() {
    applyLinks();
    renderBanner();
    syncPublished().then(function () {
      startCloudLoop();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
  else onReady();

  window.addEventListener('storage', function (e) {
    if (!e.key) return;
    if (e.key === 'hvac_theme_settings') applyTheme();
    if (e.key === 'hvac_site_links') applyLinks();
    if (e.key === 'hvac_notice_banner') renderBanner();
    if (CONFIG_KEYS.indexOf(e.key) >= 0) notifyUpdated([e.key]);
  });

  function buildPublishedConfig() {
    var payload = {
      publishedAt: new Date().toISOString(),
      data: {}
    };
    CONFIG_KEYS.forEach(function (k) {
      var v = read(k);
      if (v !== null) payload.data[k] = v;
    });
    var cloudCfg = read(CLOUD_CFG_KEY);
    if (cloudCfg) payload.data[CLOUD_CFG_KEY] = cloudCfg;
    return payload;
  }

  // =========================================================
  // 커스텀 프리미엄 알림 모달 (브라우저 기본 alert의 'domain says' 제거 및 UI 고급화)
  // =========================================================
  var _nativeAlert = typeof window !== 'undefined' ? window.alert : null;

  function showCustomAlert(message, customTitle, onConfirm) {
    if (typeof document === 'undefined') return;
    var text = String(message || '');
    var title = customTitle || '2026 HVAC Expert Seminar';

    // 메시지 첫 줄이 제목 형태(예: '📋 ...' 또는 '📢 ...')로 전달된 경우 자동 파싱 분리
    if (!customTitle && text.indexOf('\n\n') > 0) {
      var parts = text.split('\n\n');
      var candidate = parts[0].trim();
      if (candidate.length <= 40 && (candidate.indexOf('안내') >= 0 || candidate.indexOf('알림') >= 0 || candidate.indexOf('Q&A') >= 0 || candidate.indexOf('📋') >= 0 || candidate.indexOf('📢') >= 0 || candidate.indexOf('⚠️') >= 0 || candidate.indexOf('🎉') >= 0)) {
        title = candidate;
        text = parts.slice(1).join('\n\n').trim();
      }
    }

    var existing = document.getElementById('hvacCustomAlertBackdrop');
    if (existing) existing.remove();

    var styleId = 'hvacCustomAlertStyle';
    if (!document.getElementById(styleId)) {
      var st = document.createElement('style');
      st.id = styleId;
      st.textContent =
        '.hvac-alert-backdrop { position: fixed; inset: 0; z-index: 2147483640; background: rgba(0,0,0,0.78); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; padding: 20px; animation: hvacAlertFadeIn 0.2s ease-out; font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Segoe UI", Roboto, sans-serif; }\n' +
        '@keyframes hvacAlertFadeIn { from { opacity: 0; } to { opacity: 1; } }\n' +
        '@keyframes hvacAlertZoomIn { from { transform: scale(0.92); opacity: 0; } to { transform: scale(1); opacity: 1; } }\n' +
        '.hvac-alert-card { background: #0e121a; border: 1px solid rgba(243, 196, 72, 0.35); box-shadow: 0 20px 50px rgba(0,0,0,0.65), 0 0 35px rgba(243, 196, 72, 0.12); border-radius: 20px; width: 100%; max-width: 390px; padding: 24px 20px 20px; text-align: left; animation: hvacAlertZoomIn 0.22s cubic-bezier(0.175, 0.885, 0.32, 1.275); color: #f3f4f6; box-sizing: border-box; }\n' +
        '.hvac-alert-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }\n' +
        '.hvac-alert-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 800; padding: 3px 10px; border-radius: 99px; background: rgba(243,196,72,0.18); color: #f3c448; border: 1px solid rgba(243,196,72,0.35); letter-spacing: -0.01em; }\n' +
        '.hvac-alert-close-x { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: rgba(255,255,255,0.7); width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; cursor: pointer; line-height: 1; transition: all 0.15s; }\n' +
        '.hvac-alert-close-x:hover { background: rgba(255,255,255,0.18); color: #fff; }\n' +
        '.hvac-alert-title { font-size: 18px; font-weight: 900; color: #fff; margin: 0 0 12px; line-height: 1.38; letter-spacing: -0.02em; }\n' +
        '.hvac-alert-body { font-size: 13.5px; color: rgba(255, 255, 255, 0.82); line-height: 1.6; margin: 0 0 20px; white-space: pre-line; word-break: keep-all; }\n' +
        '.hvac-alert-btn { width: 100%; height: 46px; background: linear-gradient(135deg, #f3c448 0%, #e5b338 100%); border: none; color: #050808; font-weight: 900; font-size: 14.5px; border-radius: 12px; cursor: pointer; box-shadow: 0 4px 16px rgba(243, 196, 72, 0.35); display: flex; align-items: center; justify-content: center; transition: transform 0.15s, opacity 0.15s; }\n' +
        '.hvac-alert-btn:active { transform: scale(0.98); opacity: 0.9; }\n';
      document.head.appendChild(st);
    }

    var backdrop = document.createElement('div');
    backdrop.id = 'hvacCustomAlertBackdrop';
    backdrop.className = 'hvac-alert-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');

    var card = document.createElement('div');
    card.className = 'hvac-alert-card';

    var topRow = document.createElement('div');
    topRow.className = 'hvac-alert-top';
    topRow.innerHTML =
      '<span class="hvac-alert-badge">🔔 2026 HVAC SEMINAR</span>' +
      '<button type="button" class="hvac-alert-close-x" aria-label="닫기">✕</button>';

    var titleEl = document.createElement('h3');
    titleEl.className = 'hvac-alert-title';
    titleEl.textContent = title;

    var bodyEl = document.createElement('div');
    bodyEl.className = 'hvac-alert-body';
    bodyEl.textContent = text;

    var btnConfirm = document.createElement('button');
    btnConfirm.type = 'button';
    btnConfirm.className = 'hvac-alert-btn';
    btnConfirm.textContent = '확인';

    function closeAlert() {
      backdrop.remove();
      document.removeEventListener('keydown', onKeyDown);
      if (typeof onConfirm === 'function') {
        try { onConfirm(); } catch (e) {}
      }
    }

    function onKeyDown(e) {
      if (e.key === 'Escape' || e.key === 'Enter') {
        closeAlert();
      }
    }

    topRow.querySelector('.hvac-alert-close-x').addEventListener('click', closeAlert);
    btnConfirm.addEventListener('click', closeAlert);
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) closeAlert();
    });
    document.addEventListener('keydown', onKeyDown);

    card.appendChild(topRow);
    card.appendChild(titleEl);
    card.appendChild(bodyEl);
    card.appendChild(btnConfirm);
    backdrop.appendChild(card);

    if (document.body) {
      document.body.appendChild(backdrop);
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        document.body.appendChild(backdrop);
      });
    }
    setTimeout(function () {
      try { btnConfirm.focus(); } catch (e) {}
    }, 50);
  }

  // 글로벌 window.alert를 커스텀 다크골드 모달로 바인딩
  if (typeof window !== 'undefined') {
    window._nativeAlert = _nativeAlert;
    window.alert = function (message, title) {
      showCustomAlert(message, title);
    };
  }

  window.HVAC = {
    alert: showCustomAlert,
    buildPublishedConfig: buildPublishedConfig,
    CONFIG_KEYS: CONFIG_KEYS,
    read: read,
    esc: esc,
    pageId: pageId,
    getSiteBaseUrl: getSiteBaseUrl,
    applyTheme: applyTheme,
    applyLinks: applyLinks,
    getLink: getLink,
    renderBanner: renderBanner,
    openMaterialViewer: openMaterialViewer,
    toEmbedPreviewUrl: toEmbedPreviewUrl,
    syncPublished: syncPublished,
    getDeviceId: getDeviceId,
    getDeviceType: getDeviceType,
    isOperatorEmail: isOperatorEmail,
    getOperatorList: getOperatorList,
    saveOperatorList: saveOperatorList,
    getSurveyConfig: getSurveyConfig,
    saveSurveyConfig: saveSurveyConfig,
    DEFAULT_SURVEY_CONFIG: DEFAULT_SURVEY_CONFIG,
    getGameConfig: getGameConfig,
    saveGameConfig: saveGameConfig,
    DEFAULT_GAME_CONFIG: DEFAULT_GAME_CONFIG,
    getGiftRegistry: getLocalGiftRegistry,
    saveGiftToRegistry: saveLocalGiftToRegistry,
    cloud: {
      getConfig: getCloudConfig,
      poll: pollCloudChanges,
      pushConfig: pushConfigToCloud,
      pushAllConfigs: pushAllConfigsToCloud,
      pushAllAdminConfig: pushAllConfigsToCloud,
      pullAllNow: function () { return pollCloudChanges(true); },
      isActive: function () { var c = getCloudConfig(); return !!(c && c.enabled && c.dbUrl); },
      saveConfig: function (cfg) { writeLocalSilent(CLOUD_CFG_KEY, cfg); startCloudLoop(); },
      cloudPath: cloudPath,
      pushCheckinList: pushCheckinListToCloud,
      pushQnaList: pushQnaListToCloud,
      checkin: cloudCheckin,
      verifyAndClaimGift: cloudVerifyAndClaimGift,
      getGiftStatus: cloudGetGiftStatus,
      pushQuizScore: pushQuizScoreToCloud,
      pushSurvey: pushSurveyResponseToCloud,
      pushGameRecord: pushGameRecordToCloud,
      fetchGames: fetchGameSubmissionsFromCloud,
      resetGames: resetGameSubmissionsOnCloud,
      restart: startCloudLoop
    },
    onConfigUpdated: function (fn) {
      window.addEventListener('hvac:config-updated', function (e) {
        try { fn((e.detail && e.detail.keys) || CONFIG_KEYS); } catch (err) { console.warn(err); }
      });
    }
  };
})();
