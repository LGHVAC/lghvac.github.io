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
    'hvac_luckydraw_config',
    'hvac_luckydraw_state',
    'hvac_survey_config',
    'hvac_checkin_passcode',
    'hvac_game_config',
    'hvac_super_admin_hash'
  ];
  var APPLIED_MARKER = 'hvac_config_applied_at';
  var CLOUD_CFG_KEY = 'hvac_cloud_config';

  var scriptEl = document.currentScript;
  var BASE = scriptEl && scriptEl.src ? scriptEl.src.replace(/assets\/hvac-core\.js.*$/, '') : './';

  if (typeof window !== 'undefined' && typeof Storage !== 'undefined' && !window.__hvacOrigSetItem) {
    window.__hvacOrigSetItem = Storage.prototype.setItem;
  }
  var origSetItem = (typeof window !== 'undefined' && window.__hvacOrigSetItem)
    ? window.__hvacOrigSetItem
    : (typeof Storage !== 'undefined' ? Storage.prototype.setItem : null);

  function getCloudSyncLockCount() {
    return (typeof window !== 'undefined' && typeof window.__hvacCloudSyncLockCount === 'number')
      ? window.__hvacCloudSyncLockCount
      : 0;
  }

  function withCloudSyncLock(fn) {
    if (typeof window !== 'undefined') {
      window.__hvacCloudSyncLockCount = getCloudSyncLockCount() + 1;
    }
    try {
      return fn();
    } finally {
      if (typeof window !== 'undefined') {
        window.__hvacCloudSyncLockCount = Math.max(0, getCloudSyncLockCount() - 1);
      }
    }
  }

  function read(key) {
    try {
      var raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return null;
      try {
        return JSON.parse(raw);
      } catch (parseErr) {
        return raw;
      }
    } catch (e) { return null; }
  }

  function writeLocalSilent(key, val) {
    try {
      if (val === null || val === undefined) {
        localStorage.removeItem(key);
      } else {
        var serialized = typeof val === 'string' ? val : JSON.stringify(val);
        if (origSetItem) origSetItem.call(window.localStorage, key, serialized);
        else localStorage.setItem(key, serialized);
      }
    } catch (e) {}
  }

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
    });
  }

  function pageId() {
    var explicit = document.documentElement.getAttribute('data-hvac-page');
    if (explicit) {
      if (explicit === 'mc-qna') return 'qna';
      return explicit;
    }
    var p = location.pathname.toLowerCase();
    if (/\/qr(\/|$)/.test(p)) return 'qr';
    if (/admin(\.html)?$/.test(p)) return 'admin';
    if (/checkin(\.html)?$/.test(p)) return 'checkin';
    if (/qna(\.html)?$/.test(p) && !/mc-qna/.test(p)) return 'qna';
    if (/quiz(\.html)?$/.test(p) && !/quiz-winners/.test(p)) return 'quiz';
    if (/game(\.html)?$/.test(p) && !/game-leaderboard/.test(p)) return 'game';
    if (/game-leaderboard(\.html)?$/.test(p) || /lunch-screen(\.html)?$/.test(p)) return 'game-leaderboard';
    if (/attendance-dashboard(\.html)?$/.test(p)) return 'attendance-dashboard';
    if (/mc-qna(\.html)?$/.test(p)) return 'qna';
    if (/quiz-winners(\.html)?$/.test(p)) return 'quiz-winners';
    if (/luckydraw-stage(\.html)?$/.test(p)) return 'luckydraw-stage';
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
    { key: 'kakaoChat', test: function (h) { return (/pf\.kakao\.com/.test(h) && /\/chat/.test(h)) || /open\.kakao\.com/.test(h); } },
    { key: 'kakaoChannel', test: function (h) { return /pf\.kakao\.com|open\.kakao\.com/.test(h); } },
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

  var STATIC_PUBLISHED_KEYS = [
    'hvac_theme_settings',
    'hvac_site_links',
    'hvac_site_content',
    'hvac_quiz_config',
    'hvac_survey_config'
  ];

  function applyPublishedConfig(cfg) {
    if (!cfg || !cfg.publishedAt || !cfg.data || typeof cfg.data !== 'object') return false;
    if (cfg.metaConfigTs && (!lastSeenMeta.config || lastSeenMeta.config < cfg.metaConfigTs)) {
      lastSeenMeta.config = cfg.metaConfigTs;
    }
    // site-config.json에 포함된 정적 설정 키는 metaConfigTs 시점까지 최신으로 간주 (불필요한 재다운로드 방지)
    if (cfg.metaConfigTs) {
      var seenChanged = false;
      Object.keys(cfg.data).forEach(function (k) {
        if (STATIC_PUBLISHED_KEYS.indexOf(k) < 0) return;
        if ((Number(lastSeenCfgKeys[k]) || 0) < cfg.metaConfigTs) {
          lastSeenCfgKeys[k] = cfg.metaConfigTs;
          seenChanged = true;
        }
      });
      if (seenChanged) saveSeenCfgKeys();
    }
    var applied = '';
    try { applied = localStorage.getItem(APPLIED_MARKER) || ''; } catch (e) {}
    if (String(cfg.publishedAt) <= applied && read('hvac_schedule_settings') !== null) return false;

    var changed = [];
    Object.keys(cfg.data).forEach(function (k) {
      if (CONFIG_KEYS.indexOf(k) < 0 && k !== CLOUD_CFG_KEY) return;
      try {
        if (cfg.data[k] === null) localStorage.removeItem(k);
        else writeLocalSilent(k, cfg.data[k]);
        changed.push(k);
      } catch (e) {}
    });
    try { writeLocalSilent(APPLIED_MARKER, String(cfg.publishedAt)); } catch (e) {}
    refreshCommon();
    notifyUpdated(changed);
    return true;
  }

  function syncPublished() {
    if (location.protocol === 'file:' || !window.fetch) return Promise.resolve(false);
    return fetch(BASE + 'site-config.json?v=' + Date.now(), { cache: 'no-store' })
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

  // 핵심: 실시간 데이터 섹션(checkins, qna, quiz, surveys, games)의 확인 시각은
  // 페이지 진입/새로고침마다 인메모리(0)로 시작하여 타 페이지(checkin.html 등) 방문으로 인한
  // localStorage 메타 오염 때문에 새로고침 시 업데이트가 누락되는 현상을 원천 차단!
  // 단, 강제 로그아웃(session_reset_at) 및 퀴즈 리셋(quiz_reset_at) 시그널만 localStorage에 영속화.
  var LAST_META_KEY = 'hvac_last_seen_meta';
  var savedMeta = read(LAST_META_KEY);
  var lastSeenMeta = {
    config: 0,
    checkins_full: 0,
    checkins_self: 0,
    qna: 0,
    quiz_full: 0,
    quiz_self: 0,
    surveys: 0,
    games_full: 0,
    games_top3: 0,
    session_reset_at: (savedMeta && Number(savedMeta.session_reset_at)) || 0,
    quiz_reset_at: (savedMeta && Number(savedMeta.quiz_reset_at)) || 0
  };
  var latestRemoteMeta = {
    config: 0,
    checkins: 0,
    qna: 0,
    quiz: 0,
    surveys: 0,
    games: 0,
    session_reset_at: lastSeenMeta.session_reset_at,
    quiz_reset_at: lastSeenMeta.quiz_reset_at
  };
  var isSyncingCloud = false;
  var inFlightSectionPromises = {};

  // 정적 배포 설정 키(11.5KB)는 localStorage에, 동적 실시간 제어 키는 페이지 세션 인메모리에 추적
  var CFG_KEYS_SEEN = 'hvac_last_seen_cfgkeys';
  var savedCfgSeen = read(CFG_KEYS_SEEN);
  var lastSeenCfgKeys = (savedCfgSeen && typeof savedCfgSeen === 'object') ? savedCfgSeen : {};
  var sessionSeenCfgKeys = {};

  function getCfgKeySeenTs(k) {
    if (STATIC_PUBLISHED_KEYS.indexOf(k) >= 0) {
      return Number(lastSeenCfgKeys[k]) || 0;
    }
    return Number(sessionSeenCfgKeys[k]) || 0;
  }

  function setCfgKeySeenTs(k, ts) {
    var numTs = Number(ts) || 0;
    if (STATIC_PUBLISHED_KEYS.indexOf(k) >= 0) {
      lastSeenCfgKeys[k] = numTs;
    } else {
      sessionSeenCfgKeys[k] = numTs;
    }
  }

  function saveSeenCfgKeys() {
    writeLocalSilent(CFG_KEYS_SEEN, lastSeenCfgKeys);
  }

  function saveLastSeenMeta() {
    writeLocalSilent(LAST_META_KEY, {
      session_reset_at: lastSeenMeta.session_reset_at || 0,
      quiz_reset_at: lastSeenMeta.quiz_reset_at || 0
    });
  }

  function getSectionSeenKey(sec, pId) {
    var curPid = pId || pageId();
    if (sec === 'checkins') {
      var fullCheckinPages = ['admin', 'attendance-dashboard', 'luckydraw-stage', 'quiz-winners'];
      return fullCheckinPages.indexOf(curPid) >= 0 ? 'checkins_full' : 'checkins_self';
    }
    if (sec === 'quiz') {
      return (curPid === 'admin' || curPid === 'quiz-winners') ? 'quiz_full' : 'quiz_self';
    }
    if (sec === 'games') {
      return (curPid === 'lunch-screen' || curPid === 'game-leaderboard') ? 'games_top3' : 'games_full';
    }
    return sec;
  }

  function doesPageUseSection(sec, pId) {
    var curPid = pId || pageId();
    if (curPid === 'index') return false;
    if (sec === 'config') return true;
    // 관리자 콘솔(admin)은 상단 배지(Q&A, 출석부, 퀴즈 등)와 탭 전환 시 100% 정확한 실시간 현황 유지를 위해 모든 섹션 변경 감지 활성화
    if (curPid === 'admin') return true;
    if (sec === 'checkins') {
      var fullCheckinPages = ['attendance-dashboard', 'luckydraw-stage', 'quiz-winners'];
      if (fullCheckinPages.indexOf(curPid) >= 0) return true;
      var myUser = read('hvac_user_checked');
      return !!(myUser && myUser.email);
    }
    if (sec === 'qna') {
      return curPid === 'qna';
    }
    if (sec === 'quiz') {
      if (curPid === 'quiz-winners') return true;
      if (curPid === 'quiz') {
        // quiz.html은 페이지 진입/새로고침 시 1회만 본인 제출 데이터(250B) 검증 (이후 리셋은 quiz_reset_at 시그널로 0B 즉시 감지)
        if (lastSeenMeta.quiz_self !== 0) return false;
        var myQuizUser = read('hvac_user_checked');
        return !!(myQuizUser && myQuizUser.email);
      }
      return false;
    }
    if (sec === 'games') {
      return curPid === 'lunch-screen' || curPid === 'game-leaderboard';
    }
    if (sec === 'surveys') {
      return curPid === 'luckydraw-stage';
    }
    return false;
  }

  function isAdminSectionNeeded(sec) {
    return true;
  }

  function hasLocalSectionCache(sec) {
    var pId = pageId();
    if (sec === 'config') {
      return read('hvac_schedule_settings') !== null;
    }
    if (sec === 'checkins') {
      var fullCheckinPages = ['admin', 'attendance-dashboard', 'luckydraw-stage', 'quiz-winners'];
      if (fullCheckinPages.indexOf(pId) >= 0) return read('hvac_checkin_list') !== null;
      return true;
    }
    if (sec === 'qna') {
      if (pId === 'admin' || pId === 'qna') return read('hvac_qna_list') !== null;
      return true;
    }
    if (sec === 'quiz') {
      if (pId === 'admin' || pId === 'quiz-winners') return read('hvac_quiz_submissions') !== null;
      return true;
    }
    if (sec === 'games') {
      if (pId === 'lunch-screen' || pId === 'game-leaderboard') return read('hvac_game_top3') !== null;
      if (pId === 'admin') return read('hvac_game_submissions') !== null;
      return true;
    }
    if (sec === 'surveys') {
      if (pId === 'admin' || pId === 'luckydraw-stage') return read('hvac_survey_responses') !== null;
      return true;
    }
    return true;
  }

  var lastPushedConfigMap = {};
  var lastPushedSectionMap = {};
  var lastGeneratedMetaTs = 0;

  // BroadcastChannel을 통한 동일 기기/브라우저 내 열린 모든 탭 간 0ms 실시간 동기화
  var localBcChannel = null;
  try {
    if (typeof window !== 'undefined' && typeof window.BroadcastChannel === 'function') {
      localBcChannel = new BroadcastChannel('hvac_realtime_sync_v1');
      localBcChannel.onmessage = function (ev) {
        if (!ev || !ev.data || !ev.data.key) return;
        var k = ev.data.key;
        var v = ev.data.val;
        withCloudSyncLock(function () {
          if (v !== undefined) {
            writeLocalSilent(k, v);
          }
          refreshCommon();
          notifyUpdated([k]);
          try { window.dispatchEvent(new StorageEvent('storage', { key: k })); } catch (e) {}
        });
      };
    }
  } catch (e) {}

  function broadcastLocalKeyChange(key, val) {
    try {
      if (localBcChannel) {
        localBcChannel.postMessage({ key: key, val: val, ts: Date.now() });
      }
    } catch (e) {}
  }

  // Firebase RTDB는 하위 프로퍼티가 모두 빈 객체({})이면 노드 전체를 자동 삭제(null)하므로,
  // hvac_luckydraw_state에 항상 원시 리프 값(updatedAt)과 기본 객체 구조를 보장함
  function normalizeLuckyDrawState(val) {
    var base = (val && typeof val === 'object') ? Object.assign({}, val) : {};
    if (!base.drawnTiers || typeof base.drawnTiers !== 'object') base.drawnTiers = {};
    if (!base.confirmedTiers || typeof base.confirmedTiers !== 'object') base.confirmedTiers = {};
    if (!base.deliveredMilestones || typeof base.deliveredMilestones !== 'object') base.deliveredMilestones = {};
    if (!base.updatedAt) base.updatedAt = Date.now();
    return base;
  }

  function touchCloudMeta(section, subKey) {
    if (!window.fetch) return Promise.resolve();
    var now = Date.now();
    var prevSecTs = Number(lastSeenMeta[section]) || 0;
    var prevRemoteTs = Number(latestRemoteMeta[section]) || 0;
    var prevKeyTs = (section === 'config' && subKey) ? (Number(lastSeenCfgKeys[subKey]) || 0) : 0;
    // PC 간 시계 오차(Clock Skew)가 있어도 항상 이전 타임스탬프보다 큰 단조 증가(Monotonic) 타임스탬프 보장
    var ts = Math.max(now, lastGeneratedMetaTs + 1, prevSecTs + 1, prevRemoteTs + 1, prevKeyTs + 1);
    lastGeneratedMetaTs = ts;

    if (section === 'config') {
      var metaUrl = cloudPath('meta');
      if (!metaUrl) return Promise.resolve();
      var cfgKeyName = subKey || 'all';
      lastSeenMeta.config = ts;
      latestRemoteMeta.config = ts;
      saveLastSeenMeta();
      lastSeenCfgKeys[cfgKeyName] = ts;
      saveSeenCfgKeys();
      var metaBody = { config: ts, config_key: cfgKeyName };
      metaBody['config_keys/' + cfgKeyName] = ts;
      return fetch(metaUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metaBody)
      }).then(function () {
        return true;
      }).catch(function () { return false; });
    }
    var u = cloudPath('meta/' + section);
    if (!u) return Promise.resolve();
    lastSeenMeta[section] = ts;
    latestRemoteMeta[section] = ts;
    saveLastSeenMeta();
    return fetch(u, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ts)
    }).then(function () {
      return true;
    }).catch(function () { return false; });
  }

  // 관리자 -> 클라우드: 설정 데이터 업로드 (럭키드로우 상태/설정은 디바운스 없이 즉시 PUT + 핀포인트 config_key 브로드캐스트)
  function pushConfigToCloud(key, val) {
    var u = cloudPath('config/' + key);
    if (!u || !window.fetch) return Promise.resolve(false);
    var payloadVal = val;
    if (key === 'hvac_luckydraw_state') {
      payloadVal = normalizeLuckyDrawState(val);
      payloadVal.updatedAt = Math.max(Date.now(), (Number(payloadVal.updatedAt) || 0) + 1);
      withCloudSyncLock(function () {
        writeLocalSilent(key, payloadVal);
      });
    } else if ((key === 'hvac_luckydraw_config' || key === 'hvac_schedule_settings') && payloadVal && typeof payloadVal === 'object') {
      payloadVal = Object.assign({}, payloadVal, { updatedAt: Date.now() });
      withCloudSyncLock(function () {
        writeLocalSilent(key, payloadVal);
      });
    }
    var bodyStr = JSON.stringify(payloadVal);
    var now = Date.now();
    var isCriticalRealtimeKey = (key === 'hvac_luckydraw_state' || key === 'hvac_luckydraw_config' || key === 'hvac_milestone_events' || key === 'hvac_schedule_settings');
    var prev = lastPushedConfigMap[key];
    if (!isCriticalRealtimeKey && prev && prev.body === bodyStr && (now - prev.ts < 1500)) {
      return Promise.resolve(true);
    }
    lastPushedConfigMap[key] = { body: bodyStr, ts: now };
    broadcastLocalKeyChange(key, payloadVal);

    return fetch(u, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: bodyStr
    }).then(function (r) {
      if (r.ok) return touchCloudMeta('config', key).then(function () { return true; });
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
      if (r.ok) return touchCloudMeta('config', 'all').then(function () { return true; });
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
    { email: 'luis.kim', name: '김태호', role: 'admin', position: '책임', dept: 'ES아카데미팀' },
    { email: 'jungeun.lee', name: '이정은', role: 'admin', position: '책임', dept: 'ES아카데미팀' },
    { email: 'sangeun.park', name: '박상은', role: 'admin', position: '책임', dept: 'ES아카데미팀' },
    { email: 'deokjin.lee', name: '이덕진', role: 'admin', position: '책임', dept: 'ES아카데미팀' },
    { email: 'youngsoo.lee', name: '이영수', role: 'admin', position: '책임', dept: 'ES아카데미팀' },
    { email: 'jaeuk.oh', name: '오재욱', role: 'admin', position: '책임', dept: 'ES아카데미팀' },
    { email: 'jaewon28.kim', name: '김재원', role: 'admin', position: '책임', dept: 'ES아카데미팀' },
    { email: 'were77.kim', name: '김창환', role: 'admin', position: '책임', dept: 'ES아카데미팀' },
    { email: 'minyoung.ryu', name: '류민영', role: 'admin', position: '책임', dept: 'ES아카데미팀' },
    { email: 'hongkon.ryu', name: '류홍곤', role: 'admin', position: '책임', dept: 'ES아카데미팀' },
    { email: 'george.gong', name: '공성락', role: 'admin', position: '책임', dept: 'ES아카데미팀' },
    { email: 'hobeom.lee', name: '이호범', role: 'admin', position: '책임', dept: 'ES아카데미팀' },
    { email: 'gabae.han', name: '한가배', role: 'admin', position: '사원', dept: 'ES아카데미팀' },
    { email: 'hyukyoon.kwon', name: '권윤호', role: 'admin', position: '기정', dept: 'ES아카데미팀' },
    { email: 'jeongog65.kim', name: '김정옥', role: 'admin', position: '기성', dept: 'ES아카데미팀' },
    { email: 'hvac.admin', name: '세미나운영진', role: 'admin', position: '운영팀', dept: 'ES아카데미팀' }
  ];

  // 사전 등록 마스터 명부 (214명: 일반 사전등록 임직원 184명, 운영진 15명, VIP초대 7명, 외부초청 6명, 하이엠 2명)
  var DEFAULT_ROSTER = [
    {"category":"pre","dept":"ES CX/상품전략팀","email":"bongjin.park","name":"박봉진","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES전략기획팀","email":"sol.park","name":"박솔","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES전략기획팀","email":"jinock.kim","name":"김진옥","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES서비스사업실","email":"jinsung83.kim","name":"김진성","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES서비스팀","email":"hanyoung.jeong","name":"정한영","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES서비스팀","email":"gd.bae","name":"배건덕","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES서비스팀","email":"juongwoong.park","name":"박정웅","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES서비스팀","email":"kyunglok.kang","name":"강경록","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES유지보수영업팀","email":"sh.ahn","name":"안상현","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES유지보수영업팀","email":"changhoon777.lee","name":"이창훈","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES유지보수영업팀","email":"woosang.oh","name":"오우상","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES유지보수영업팀","email":"ivy.lee","name":"이수정","position":"선임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"칠러서비스파트","email":"gyuyul.yoo","name":"유규열","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES에너지컨설팅팀","email":"airjaeho.park","name":"박재호","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES에너지컨설팅팀","email":"jungwon1.lee","name":"이정원","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES에너지컨설팅팀","email":"minsoo7.kim","name":"김민수","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES에너지컨설팅팀","email":"hobok.lee","name":"이호복","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES에너지컨설팅팀","email":"hf.kim","name":"김해봉","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES에너지컨설팅팀","email":"youngjin41.jang","name":"장영진","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES에너지컨설팅팀","email":"youngdae16.kim","name":"김영대","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES에너지컨설팅팀","email":"ih.park","name":"박인환","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES에너지컨설팅팀","email":"kwangju.jeong","name":"정광주","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES에너지컨설팅팀","email":"younghoon.oh","name":"오영훈","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES에너지컨설팅팀","email":"sungil.yun","name":"윤성일","position":"선임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링AX팀","email":"jk.joung","name":"정진기","position":"책임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링AX팀","email":"jaeyong.lee","name":"이재용","position":"책임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링AX팀","email":"huidong.kim","name":"김휘동","position":"책임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링AX팀","email":"hyesung.yang","name":"양혜성","position":"책임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링AX팀","email":"myunghwan.choi","name":"최명환","position":"책임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링AX팀","email":"jinpa.jo","name":"조진파","position":"책임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링AX팀","email":"garam.lee","name":"이가람","position":"선임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링AX팀","email":"amy.lee","name":"이혜림","position":"선임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링기획팀","email":"seunghun.yeom","name":"염승훈","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링기획팀","email":"seungyong1004.lee","name":"이승용","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링기획팀","email":"jonghak.kim","name":"김종학","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링기획팀","email":"hd.jang","name":"장헌덕","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링기획팀","email":"ilkeun.nam","name":"남일근","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링기획팀","email":"byungkii.kim","name":"김병기","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링기획팀","email":"tom.kim","name":"김근수","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링기획팀","email":"seonghoon.han","name":"한성훈","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링기획팀","email":"yongseon.jo","name":"조용선","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링기획팀","email":"lee.chaeyoung","name":"이채영","position":"사원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링담당","email":"ohik.kang","name":"강기호","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링담당","email":"byungkyu.bae","name":"배병규","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링담당","email":"sh.min","name":"민승환","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링담당","email":"youshin.hwang","name":"황유신","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링제어팀","email":"hyeongseop.kim","name":"김형섭","position":"책임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링제어팀","email":"seunghyup.noh","name":"노승협","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링제어팀","email":"junh26.lee","name":"이준희","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링제어팀","email":"junseok.mun","name":"문준석","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링제어팀","email":"daekuk.kim","name":"김대국","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링제어팀","email":"shinwon.ahn","name":"안신원","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링제어팀","email":"jake.nam","name":"남명진","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링제어팀","email":"ea.ko","name":"고은애","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링제어팀","email":"jisun14.lee","name":"이지선","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링제어팀","email":"kyu.kim","name":"김명규","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링제어팀","email":"yongchul.cho","name":"조용출","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링제어팀","email":"jongpil.yu","name":"유종필","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES엔지니어링제어팀","email":"jinyoung0923.choi","name":"최진영","position":"선임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES필드엔지니어링팀","email":"ryon.heo","name":"허원행","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES필드엔지니어링팀","email":"jinwoo.kim","name":"김진우","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES필드엔지니어링팀","email":"dokyu.lee","name":"이도규","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES필드엔지니어링팀","email":"mihyun.kim","name":"김미현","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES필드엔지니어링팀","email":"gyuhyun.hwang","name":"황규현","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES필드엔지니어링팀","email":"hyunjiny.nam","name":"남현진","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES필드엔지니어링팀","email":"bonmin.ku","name":"구본민","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES필드엔지니어링팀","email":"derrick.jeong","name":"정성주","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES필드엔지니어링팀","email":"woongseok.noh","name":"노웅석","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES필드엔지니어링팀","email":"hyeongdae.ju","name":"주형대","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES필드엔지니어링팀","email":"kh.cho","name":"조광희","position":"선임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES필드엔지니어링팀","email":"junyoung.oh","name":"오준영","position":"선임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES한국SE팀","email":"junggyu9.park","name":"박정규","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES한국SE팀","email":"hch.kim","name":"김현철","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES한국SE팀","email":"daegun1.park","name":"박대건","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES한국SE팀","email":"kyomin.koo","name":"구교민","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES한국SE팀","email":"hyunju.shin","name":"신현주","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES한국SE팀","email":"haegyoun.kim","name":"김해균","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES한국SE팀","email":"myeongjun.ko","name":"고명준","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES한국SE팀","email":"namgui.cho","name":"조남귀","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES한국SE팀","email":"hyuno1.kim","name":"김현오","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES한국SE팀","email":"sukjung.kang","name":"강석중","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES한국SE팀","email":"taejin.yu","name":"유태진","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES한국SE팀","email":"yj4498.song","name":"송영중","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES한국SE팀","email":"taejoon.heo","name":"허태준","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES한국SE팀","email":"haio.yang","name":"양해오","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES한국SE팀","email":"joohwan82.lee","name":"이주환","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES한국SE팀","email":"js.seo","name":"서정석","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES한국SE팀","email":"soohyuk.park","name":"박수혁","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES한국SE팀","email":"jinhan.park","name":"박진한","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES한국SE팀","email":"yoonsung.choi","name":"최윤성","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES한국SE팀","email":"yha.an","name":"안양환","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES한국SE팀","email":"kyuho.shim","name":"심규호","position":"선임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES한국SE팀","email":"jaehwan.jeong","name":"정재환","position":"선임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES한국SE팀","email":"sunju1.kim","name":"김선주","position":"선임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"Air Science Task","email":"keonwang.lee","name":"이건왕","position":"책임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES AI/SW솔루션기획파트","email":"sungyong.sohn","name":"손성용","position":"책임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES CAE팀","email":"jungsoo91.lee","name":"이정수","position":"책임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES데이터솔루션개발Project","email":"youngjin86.kim","name":"김영진","position":"책임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES선행연구1팀","email":"hyunjong22.kim","name":"김현종","position":"책임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES응용공조연구2Project","email":"juntae1.kim","name":"김준태","position":"책임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES응용공조연구2Project","email":"yechan1.lee","name":"이예찬","position":"연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES B2B아웃소싱사업지원파트","email":"byoungkook.moon","name":"문병국","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES B2B아웃소싱사업지원파트","email":"kwangseuk.kim","name":"김광석","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES B2B아웃소싱사업지원파트","email":"younghyo.kwon","name":"권영효","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES SW품질보증팀","email":"hyuna.yu","name":"유현아","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES신뢰성/FMEA팀","email":"youngmo.kim","name":"김영모","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES Electrification Task","email":"nick.lee","name":"이재원","position":"선임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES북미/중남미SE팀","email":"jimmy.kil","name":"길성진","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES북미/중남미SE팀","email":"ks.kwon","name":"권기상","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES북미/중남미SE팀","email":"yongnam.cho","name":"조용남","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES북미/중남미SE팀","email":"minhyeok17.kim","name":"김민혁","position":"선임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES북미/중남미SE팀","email":"jaeyoung3692.cho","name":"조재영","position":"선임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES북미/중남미SE팀","email":"sungmin88.kang","name":"강성민","position":"선임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES북미/중남미영업1팀","email":"bomi.ryu","name":"류보미","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES북미/중남미영업1팀","email":"taejin.sim","name":"심태진","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES아시아/인도SE팀","email":"heon7.lee","name":"이헌","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES아시아/인도SE팀","email":"taewon7.kang","name":"강태원","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES아시아/인도SE팀","email":"sewon630.park","name":"박세원","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES아시아/인도SE팀","email":"sanghun.yang","name":"양상훈","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES아시아/인도SE팀","email":"hanyoul.nam","name":"남한열","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES아시아/인도SE팀","email":"yonghyun81.kim","name":"김용현","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES아시아/인도SE팀","email":"junsung.maeng","name":"맹준성","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES유럽/중아SE팀","email":"seongchan.jo","name":"조성찬","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES유럽/중아SE팀","email":"myongsok.ryu","name":"류명석","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES유럽/중아SE팀","email":"seungtak.kang","name":"강승탁","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES유럽/중아SE팀","email":"taejoon.park","name":"박태준","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES유럽/중아SE팀","email":"soongin.lee","name":"이숭인","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES유럽/중아SE팀","email":"kyoungmun.kang","name":"강경문","position":"선임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES유럽/중아SE팀","email":"moonkyo.choi","name":"최문교","position":"선임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES중아영업1팀","email":"jungjune.yoon","name":"윤정준","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES해외건설영업팀","email":"bumsuk.kim","name":"김범석","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"글로벌히팅매출확대Task","email":"kwangin.yeom","name":"염광인","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"칠러해외영업팀","email":"shihyeong.lee","name":"이시형","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"스마트파크전시운영파트","email":"crystal7.lee","name":"이수정","position":"선임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"SAC규격팀","email":"eunkyung.lee","name":"이은경","position":"책임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"SAC규격팀","email":"jeewoong.sang","name":"상지웅","position":"책임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"SAC사업성장Task","email":"channy.park","name":"박순찬","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"SAC사이클로직Project","email":"jinsik.kim","name":"김진식","position":"책임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"SAC상품기획팀","email":"dalnim.jung","name":"정이안","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"SAC상품기획팀","email":"soy.kim","name":"김소윤","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"SAC상품기획팀","email":"claude.lee","name":"이상훈","position":"선임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"SAC어플라이드사업Task","email":"joonwoo.kim","name":"김준우","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"히팅개발Project","email":"dooryoung.park","name":"박두룡","position":"선임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"BMS팀","email":"jayong.koo","name":"구자용","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"BMS팀","email":"chulky.kim","name":"김철기","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"BMS팀","email":"jongcool.lee","name":"이종환","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"BMS팀","email":"ee.lee","name":"이승섭","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"BMS팀","email":"sangmoo.kim","name":"김상무","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"ES현장PM파트","email":"junwon.choi","name":"최준원","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"데이터센터솔루션Task","email":"taeyoon82.kim","name":"김태윤","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"데이터센터솔루션Task","email":"myungkyu.lee","name":"이명규","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드SE1팀","email":"js85.kang","name":"강종석","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드SE1팀","email":"soo.choi","name":"최수인","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드SE1팀","email":"youngwook.kwon","name":"권영욱","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드SE1팀","email":"jh37.lee","name":"이재혁","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드SE1팀","email":"taehee04.kim","name":"김태희","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드SE1팀","email":"ho1.lee","name":"이호","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드SE1팀","email":"yeongnam.choi","name":"최영남","position":"선임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드SE2팀","email":"jinseob.noh","name":"노진섭","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드SE2팀","email":"changho0.han","name":"한창호","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드SE2팀","email":"inho.seo","name":"서인호","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드SE2팀","email":"jinwoo1020.nam","name":"남진우","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드SE2팀","email":"hyeonseok.kim","name":"김현석","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드SE2팀","email":"chanhoe.goo","name":"구찬회","position":"선임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드SE3팀","email":"kj.keum","name":"금기정","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드SE3팀","email":"kyungil.jung","name":"정경일","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드SE3팀","email":"myunghoon.cho","name":"조명훈","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드SE3팀","email":"henrik.sim","name":"심재훈","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드SE3팀","email":"jaesang.lee","name":"이재상","position":"선임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드영업1팀","email":"jerry.jang","name":"장준영","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드영업1팀","email":"myoungsu2.kim","name":"김명수","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드영업2팀","email":"junho.park","name":"박준호","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드플랜트영업팀","email":"sunghoon4.kim","name":"김성훈","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드플랜트영업팀","email":"gil.han","name":"한길","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드플랜트영업팀","email":"daewon.lee","name":"이대원","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드플랜트영업팀","email":"maeum1.han","name":"한마음","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"어플라이드플랜트영업팀","email":"jungsuh.park","name":"박정수","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"데이터센터칠러개발TDR","email":"junnhak.park","name":"박준학","position":"선임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"데이터센터칠러개발TDR","email":"jeongtaek.oh","name":"오정택","position":"선임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"데이터센터칠러개발TDR","email":"jihoo.kim","name":"김지후","position":"선임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"칠러개발실","email":"hyunuk.cho","name":"조현욱","position":"책임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"칠러사업담당","email":"tg00.kim","name":"김태근","position":"책임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"칠러상품기획파트","email":"taewang.kim","name":"김태왕","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"pre","dept":"칠러원전개발Project","email":"blueani.kim","name":"김용훈","position":"책임연구원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"operator","dept":"ES아카데미팀","email":"luis.kim","name":"김태호","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"operator","dept":"ES아카데미팀","email":"jungeun.lee","name":"이정은","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"operator","dept":"ES아카데미팀","email":"sangeun.park","name":"박상은","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"operator","dept":"ES아카데미팀","email":"deokjin.lee","name":"이덕진","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"operator","dept":"ES아카데미팀","email":"youngsoo.lee","name":"이영수","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"operator","dept":"ES아카데미팀","email":"jaeuk.oh","name":"오재욱","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"operator","dept":"ES아카데미팀","email":"jaewon28.kim","name":"김재원","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"operator","dept":"ES아카데미팀","email":"were77.kim","name":"김창환","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"operator","dept":"ES아카데미팀","email":"minyoung.ryu","name":"류민영","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"operator","dept":"ES아카데미팀","email":"hongkon.ryu","name":"류홍곤","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"operator","dept":"ES아카데미팀","email":"george.gong","name":"공성락","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"operator","dept":"ES아카데미팀","email":"hobeom.lee","name":"이호범","position":"책임","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"operator","dept":"ES아카데미팀","email":"gabae.han","name":"한가배","position":"사원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"operator","dept":"ES아카데미팀","email":"hyukyoon.kwon","name":"권윤호","position":"기정","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"operator","dept":"ES아카데미팀","email":"jeongog65.kim","name":"김정옥","position":"기성","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"vip","dept":"ES사업본부","email":"jameslee.lee","name":"이재성","position":"본부장","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"vip","dept":"ES연구소","email":"saikee.oh","name":"오세기","position":"연구소장","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"vip","dept":"SAC사업부","email":"john.bae","name":"배정현","position":"사업부장","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"vip","dept":"ES엔지니어링담당","email":"marino.kwon","name":"권민호","position":"담당","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"vip","dept":"Air Science Task","email":"hh.park","name":"박형호","position":"수석연구위원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"vip","dept":"ES응용공조연구1Project","email":"yongcheol.sa","name":"사용철","position":"연구위원","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"vip","dept":"어플라이드SE실","email":"minho.so","name":"소민호","position":"실장","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"external","dept":"국민대학교","email":"yschang@kookmin.ac.kr","name":"장영수","position":"교수","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"external","dept":"서울대학교","email":"msyeo@snu.ac.kr","name":"여명석","position":"교수","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"external","dept":"중앙대학교","email":"shlee89@cau.ac.kr","name":"이성혁","position":"교수","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"external","dept":"단국대학교","email":"hongchong@gmail.com","name":"조홍종","position":"교수","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"external","dept":"토지주택연구원","email":"jhyoo@lh.or.kr","name":"유정현","position":"수석","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"external","dept":"특강 연사","email":"---","name":"이정모","position":"관장","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"him","dept":"공조지원파트","email":"hyunseok.kang","name":"강석현","position":"파트장","regMethod":"pre","regMethodLabel":"사전 등록"},
    {"category":"him","dept":"공조지원파트","email":"jongchil.noh","name":"노종칠","position":"선임","regMethod":"pre","regMethodLabel":"사전 등록"}
  ];

  function getRosterList() {
    try {
      var saved = read('hvac_roster_list');
      if (Array.isArray(saved) && saved.length >= DEFAULT_ROSTER.length && !saved.some(function (r) { return r && r.email === 'user1'; })) {
        return saved;
      }
      writeLocalSilent('hvac_roster_list', DEFAULT_ROSTER);
      return DEFAULT_ROSTER;
    } catch (e) {
      return DEFAULT_ROSTER;
    }
  }

  function findRosterEntry(email, name) {
    var cleanEmail = String(email || '').toLowerCase().replace('@lge.com', '').trim();
    var cleanName = String(name || '').trim();
    var roster = getRosterList();
    return roster.find(function (r) {
      if (!r) return false;
      var rEmail = String(r.email || '').toLowerCase().replace('@lge.com', '').trim();
      if (rEmail && rEmail !== '---' && cleanEmail && rEmail === cleanEmail) return true;
      if (rEmail === '---' && cleanName && String(r.name || '').trim() === cleanName) return true;
      return false;
    }) || null;
  }

  // 럭키드로우 추첨 대상자 적격 판정 (사전 등록 임직원[일반/운영진] + 현장 등록 임직원만 선정; VIP초대, 하이엠, 외부 인원[현장등록 후 외부로 분류된 인원 포함], 차단계정 100% 제외)
  function isLuckyDrawEligibleAttendee(att, blockedList) {
    if (!att) return false;
    var cleanEmail = String(att.email || '').toLowerCase().replace('@lge.com', '').trim();
    var cleanName = String(att.name || '').trim();
    var blocked = Array.isArray(blockedList) ? blockedList : (read('hvac_blocked_users') || []);
    if (blocked.some(function (b) { return String(b || '').toLowerCase().replace('@lge.com', '').trim() === cleanEmail; })) {
      return false;
    }

    var seqNum = Number(att.seq) || 0;
    var cat = String(att.category || '').trim().toLowerCase();
    var type = String(att.type || '').trim().toLowerCase();
    var reg = String(att.regMethod || '').trim().toLowerCase();
    var dept = String(att.dept || att.org || '').trim().toLowerCase();
    var pos = String(att.position || att.title || '').trim().toLowerCase();

    var rosterEntry = findRosterEntry(cleanEmail, cleanName);
    var rosterCat = rosterEntry ? String(rosterEntry.category || '').trim().toLowerCase() : '';

    // 1. 외부 인원 (external) 제외 — 사전 등록 외부 초청 인원 + 현장 등록 후 외부 인원으로 분류된 인원 모두 제외
    if (cat === 'external' || type === 'external' || reg === 'external' || rosterCat === 'external') return false;
    if (seqNum >= 500 && seqNum < 700) return false;
    if (cat.indexOf('외부') >= 0 || cat.indexOf('사외') >= 0 || dept.indexOf('외부') >= 0 || dept.indexOf('사외') >= 0 || pos.indexOf('강사') >= 0 || pos.indexOf('교수') >= 0 || pos.indexOf('관장') >= 0 || pos.indexOf('학생') >= 0) {
      return false;
    }

    // 2. VIP 초대 인원 (vip) 제외
    if (cat === 'vip' || type === 'vip' || reg === 'vip' || rosterCat === 'vip') return false;
    if (seqNum >= 700 && seqNum < 900) return false;
    if (cat.indexOf('vip') >= 0 || cat.indexOf('초대') >= 0 || dept.indexOf('vip') >= 0 || dept.indexOf('초대') >= 0 || pos.indexOf('vip') >= 0 || pos.indexOf('초대') >= 0) {
      return false;
    }

    // 3. 하이엠 인원 (him) 제외
    if (cat === 'him' || type === 'him' || reg === 'him' || rosterCat === 'him') return false;
    if (seqNum >= 900 && seqNum < 1000) return false;
    if (cat.indexOf('하이엠') >= 0 || dept.indexOf('하이엠') >= 0 || pos.indexOf('하이엠') >= 0 || cleanEmail.indexOf('him.co.kr') >= 0) {
      return false;
    }

    // 4. 남은 인원: 사전 등록 임직원(pre, operator) 및 현장 등록 임직원(walkin) -> 추첨 대상 포함!
    return true;
  }

  function getOperatorList() {
    var roster = getRosterList();
    if (Array.isArray(roster) && roster.length) {
      var ops = roster.filter(function (r) {
        return r && (r.category === 'operator' || r.regMethod === 'operator' || (r.dept && r.dept.indexOf('ES아카데미') >= 0));
      });
      if (ops.length > 0) return ops;
    }
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
    if (clean === 'hvac.admin') return true;
    var ops = getOperatorList();
    return ops.some(function (o) {
      var opClean = String(o.email || '').trim().toLowerCase().replace('@lge.com', '');
      return opClean === clean;
    });
  }

  // -------------------------------------------------------------
  // Q&A 질문자 정보 (이름 + 호칭/직책 + 순번) 표준 포맷터 및 기기별 공감 상태 관리
  // -------------------------------------------------------------
  var INVALID_POS_KEYWORDS = ['운영진', '사전등록', '사전 등록', '외부', '외부 인원', 'vip', 'vip 초대', '하이엠', 'walkin', 'pre', 'operator', 'him', 'external', '현장등록', '현장 추가 등록', '참석자', '참가자'];

  function isValidPositionLabel(pos) {
    if (!pos) return false;
    var p = String(pos).trim().toLowerCase();
    if (!p) return false;
    return INVALID_POS_KEYWORDS.indexOf(p) === -1;
  }

  function formatQnaAuthor(qOrUser, includeSeq) {
    if (!qOrUser) return '참석자';
    var obj = typeof qOrUser === 'string' ? { author: qOrUser } : qOrUser;
    var rawAuthor = String(obj.author || obj.userName || obj.authorName || obj.name || '').trim();
    var seq = obj.checkinSeq || obj.authorSeq || obj.seq || null;

    // rawAuthor 내에 (No.XX) 또는 #XX 가 있으면 추출 후 기본 문자열에서 제거
    var noMatch = rawAuthor.match(/\(\s*No\.?\s*(\d+)\s*\)/i) || rawAuthor.match(/#\s*(\d+)/);
    if (!seq && noMatch && noMatch[1]) {
      seq = parseInt(noMatch[1], 10);
    }
    var strippedAuthor = rawAuthor
      .replace(/\(\s*No\.?\s*\d+\s*\)/gi, '')
      .replace(/#\s*\d+/g, '')
      .trim();

    var cleanEmail = String(obj.authorEmail || obj.email || '').toLowerCase().replace(/@lge\.com$/i, '').trim();
    var explicitName = String(obj.userName || obj.authorName || obj.name || '').trim()
      .replace(/\(\s*No\.?\s*\d+\s*\)/gi, '')
      .trim();
    var baseName = explicitName || (strippedAuthor.split(/\s+/)[0] || '').trim();
    var pos = String(obj.authorPosition || obj.position || obj.title || '').trim();
    if (!isValidPositionLabel(pos)) pos = '';

    // rawAuthor에 이미 "홍길동 책임" 형태로 호칭이 포함된 경우 추출
    if (!pos && strippedAuthor && baseName && strippedAuthor.indexOf(baseName) === 0) {
      var tail = strippedAuthor.slice(baseName.length).trim();
      // 괄호 부서명 등 제거 후 첫 토큰 확인
      var tailClean = tail.replace(/\([^)]*\)/g, '').trim();
      if (tailClean && isValidPositionLabel(tailClean)) {
        pos = tailClean;
      }
    }

    // 호칭(직책)이나 순번이 비어 있으면 사전 등록 명부(214명) 및 실시간 출석부(hvac_checkin_list)에서 자동 보완
    if ((!pos || !seq) && (cleanEmail || baseName)) {
      var rosterEntry = findRosterEntry(cleanEmail, baseName);
      if (rosterEntry) {
        if (!pos && isValidPositionLabel(rosterEntry.position || rosterEntry.title)) {
          pos = String(rosterEntry.position || rosterEntry.title).trim();
        }
        if (!baseName && rosterEntry.name) {
          baseName = String(rosterEntry.name).trim();
        }
      }
      var cList = read('hvac_checkin_list');
      if (Array.isArray(cList) && cList.length > 0) {
        var cMatch = cList.find(function (c) {
          if (!c) return false;
          var ce = String(c.email || '').toLowerCase().replace(/@lge\.com$/i, '').trim();
          var cn = String(c.name || '').trim();
          if (cleanEmail && ce && ce === cleanEmail) return true;
          if (baseName && cn && cn === baseName) return true;
          return false;
        });
        if (cMatch) {
          if (!pos && isValidPositionLabel(cMatch.position || cMatch.title)) {
            pos = String(cMatch.position || cMatch.title).trim();
          }
          if (!seq && cMatch.seq) {
            seq = cMatch.seq;
          }
        }
      }
    }

    var nameWithPos = baseName || strippedAuthor || '참석자';
    if (pos && nameWithPos.indexOf(pos) === -1) {
      nameWithPos = nameWithPos + ' ' + pos;
    }
    if (includeSeq !== false && seq) {
      return nameWithPos + ' (No.' + String(seq).padStart(2, '0') + ')';
    }
    return nameWithPos;
  }

  var QNA_LIKED_STORAGE_KEY = 'hvac_qna_liked_ids';

  function getLikedQnaMap() {
    var map = read(QNA_LIKED_STORAGE_KEY);
    if (map && typeof map === 'object' && !Array.isArray(map)) return map;
    return {};
  }

  function setQnaLikedState(qId, isLiked) {
    if (!qId) return;
    var map = getLikedQnaMap();
    var k = String(qId);
    if (isLiked) map[k] = true;
    else delete map[k];
    writeLocalSilent(QNA_LIKED_STORAGE_KEY, map);
  }

  function isQnaLiked(qId) {
    if (!qId) return false;
    var map = getLikedQnaMap();
    return !!map[String(qId)];
  }

  function normalizeQnaItemForLocal(q, likedMap) {
    if (!q || typeof q !== 'object') return q;
    var map = likedMap || getLikedQnaMap();
    var copy = Object.assign({}, q);
    var starred = !!(copy.isStarred || copy.isPinned);
    copy.isStarred = starred;
    copy.isPinned = starred;
    copy.likes = Math.max(0, Number(copy.likes) || 0);
    copy.isLiked = !!(copy.id && map[String(copy.id)]);
    copy.author = formatQnaAuthor(copy, true);
    return copy;
  }

  function sanitizeQnaListForCloud(qList) {
    if (!Array.isArray(qList)) return [];
    return qList.filter(Boolean).map(function (q) {
      var copy = Object.assign({}, q);
      var starred = !!(copy.isStarred || copy.isPinned);
      copy.isStarred = starred;
      copy.isPinned = starred;
      copy.likes = Math.max(0, Number(copy.likes) || 0);
      copy.author = formatQnaAuthor(copy, true);
      // 🚨 기기별 상태인 isLiked는 클라우드 공유 JSON에서 제거하여 타 참석자 화면에서 이미 공감된 것으로 오작동하는 현상 방지!
      delete copy.isLiked;
      return copy;
    });
  }

  // -------------------------------------------------------------
  // 앱 빌드 버전 검증 및 구버전 로컬 캐시 자동 무효화 / 정합성 갱신
  // -------------------------------------------------------------
  var HVAC_BUILD_VERSION = '261116_0810';

  function getCurrentAppVersion() {
    try {
      var cs = document.currentScript;
      if (!cs) {
        var scripts = document.querySelectorAll('script[src*="hvac-core.js"]');
        if (scripts.length > 0) cs = scripts[scripts.length - 1];
      }
      if (cs && cs.src) {
        var m = cs.src.match(/[?&]v=([a-zA-Z0-9_]+)/);
        if (m && m[1]) return m[1];
      }
    } catch (e) {}
    try {
      var appVer = localStorage.getItem('hvac_app_build_version');
      if (appVer) return appVer;
    } catch (e) {}
    return HVAC_BUILD_VERSION;
  }

  // 캐시 무효화용 일회성 _hv 쿼리 파라미터가 있으면 URL 깔끔하게 정리 (기존 쿼리/해시 보존)
  try {
    if (typeof URLSearchParams !== 'undefined' && window.history && window.history.replaceState && window.location.search.indexOf('_hv=') >= 0) {
      var _urlSp = new URLSearchParams(window.location.search);
      if (_urlSp.has('_hv')) {
        _urlSp.delete('_hv');
        var _qs = _urlSp.toString();
        var _cleanHref = window.location.pathname + (_qs ? ('?' + _qs) : '') + (window.location.hash || '');
        window.history.replaceState(null, '', _cleanHref);
      }
    }
  } catch (e) {}

  (function checkBuildVersion() {
    try {
      var activeVer = getCurrentAppVersion();
      var lastVersion = localStorage.getItem('hvac_app_build_version');
      if (lastVersion !== activeVer) {
        localStorage.setItem('hvac_app_build_version', activeVer);

        // 1. 구버전 로컬스토리지 명부/운영진/메타타임스탬프 캐시 삭제 (최신 DEFAULT_ROSTER 및 클라우드 상태 즉시 반영)
        localStorage.removeItem('hvac_roster_list');
        localStorage.removeItem('hvac_operator_list');
        localStorage.removeItem('hvac_last_seen_cfgkeys');
        localStorage.removeItem('hvac_last_seen_meta');
        localStorage.removeItem(APPLIED_MARKER);

        // 2. 이미 체크인된 사용자 정보가 있다면, 최신 마스터 명부 기준으로 호칭/직급/소속/카테고리/등록방식 자동 갱신
        var savedUserRaw = localStorage.getItem('hvac_user_checked');
        if (savedUserRaw) {
          try {
            var userObj = JSON.parse(savedUserRaw);
            if (userObj && userObj.email) {
              var rMatch = findRosterEntry(userObj.email, userObj.name);
              if (rMatch) {
                userObj.regMethod = 'pre';
                if (rMatch.category) userObj.category = rMatch.category;
                if (rMatch.position) userObj.position = rMatch.position;
                if (rMatch.title) userObj.title = rMatch.title;
                if (rMatch.dept) userObj.dept = rMatch.dept;
                if (rMatch.category === 'operator') userObj.isOperator = true;
              }
              localStorage.setItem('hvac_user_checked', JSON.stringify(userObj));
            }
          } catch (e) {}
        }
        console.log('[HVAC] App updated to build version:', HVAC_BUILD_VERSION);
      }
    } catch (e) {}
  })();

  var DEFAULT_MILESTONES = [
    { seq: 1, prize: '커피 쿠폰 증정' },
    { seq: 10, prize: '커피 쿠폰 증정' },
    { seq: 100, prize: '커피 쿠폰 증정' }
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
    lockMessage: '점심시간 미니게임은 12:30 점심 시간에 맞춰 공식 오픈됩니다. 잠시 후 참여해 주세요!',
    openedAt: null,
    resetAt: 0,
    stopwatchBlindSec: 3,
    tempTarget: 20.0,
    tempSeason: 'winter',
    maxTries: 3
  };

  function getGameConfig() {
    var saved = read('hvac_game_config');
    var res = saved ? Object.assign({}, DEFAULT_GAME_CONFIG, saved) : DEFAULT_GAME_CONFIG;
    if (res && res.lockMessage && res.lockMessage.indexOf('오찬') >= 0) {
      res.lockMessage = res.lockMessage.replace(/오찬/g, '점심');
    }
    return res;
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
    var rosterMatch = findRosterEntry(attendee.email, attendee.name);
    var isOp = isOperatorEmail(cleanEmail) || !!attendee.isOperator || (rosterMatch && (rosterMatch.category === 'operator' || rosterMatch.dept === 'ES아카데미팀'));
    var newSessionToken = 'tok_' + getDeviceId() + '_' + Date.now();

    // 카테고리 결정: 운영진(300번대) / 외부(500번대) / VIP(700번대) / 하이엠(900번대) / 현장추가(200번대) / 사전등록(1번대)
    var cat = attendee.category;
    if (!cat && rosterMatch && rosterMatch.category) {
      cat = rosterMatch.category;
    }
    if (!cat) {
      if (isOp || attendee.type === 'operator') cat = 'operator';
      else if (String(attendee.dept || '').includes('하이엠') || String(attendee.position || '').includes('하이엠')) cat = 'him';
      else if (String(attendee.dept || '').includes('사외') || String(attendee.position || '').includes('강사') || String(attendee.position || '').includes('교수') || String(attendee.position || '').includes('관장') || String(attendee.dept || '').includes('외부')) cat = 'external';
      else if (String(attendee.dept || '').includes('VIP') || String(attendee.position || '').includes('초대')) cat = 'vip';
      else if (attendee.type === 'pre' || attendee.type === 'matched' || attendee.type === 'pre_registered' || !!rosterMatch) cat = 'pre';
      else cat = 'walkin';
    }

    // 1) 이미 체크인한 사용자인지 먼저 확인 (재접속 시 기존 순번 유지 & 활성 세션 토큰 갱신)
    return fetch(existingUrl, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (existing) {
        if (existing && existing.seq) {
          var curDeviceId = getDeviceId();
          var prevDeviceId = existing.activeDeviceId;

          // 🚨 다른 기기 접속 시 동일인 확인 및 기기 세션 전환 (1인 1기기 정책 완화)
          var isBoundToOtherDevice = prevDeviceId && prevDeviceId !== curDeviceId && prevDeviceId !== 'admin_console';
          if (isBoundToOtherDevice) {
            var existingName = String(existing.name || '').trim();
            var incomingName = String(attendee.name || '').trim();
            var isSamePerson = existingName && incomingName && (existingName === incomingName);

            // 동일인이 아닌 경우 -> 절대 불가!
            if (!isSamePerson) {
              return {
                error: 'IDENTITY_MISMATCH',
                alreadyCheckedIn: true,
                isSamePerson: false,
                seq: existing.seq,
                checkinId: existing.checkinId || ('HVAC-' + String(existing.seq).padStart(3, '0')),
                name: existing.name,
                email: existing.email,
                message: '입력하신 성명이 기존 등록 성명과 일치하지 않습니다.'
              };
            }

            // 동일인인데 아직 사용자 명시적 기기 전환 확인(allowDeviceTakeover)이 전달되지 않은 경우
            if (!attendee.allowDeviceTakeover) {
              return {
                error: 'DEVICE_DUPLICATE_PROMPT',
                alreadyCheckedIn: true,
                isSamePerson: true,
                seq: existing.seq,
                checkinId: existing.checkinId || ('HVAC-' + String(existing.seq).padStart(3, '0')),
                name: existing.name,
                email: existing.email,
                checkinTime: existing.checkinTime,
                regMethod: existing.regMethod,
                isManual: !!(existing.isManual || existing.regMethod === 'manual'),
                message: '이미 다른 기기에서 출석된 사용자입니다. 동일인 확인 후 현재 기기로 세션을 전환할 수 있습니다.'
              };
            }
          }

          var nowEpoch = Date.now();
          // 관리자가 기출석자 카테고리를 수정한 경우(예: 현장등록자를 'external' 등 외부 인원으로 분류) 기존 값 우선 보존!
          // 단, 기존에 walkin으로 잘못 저장되어 있었는데 사전 명부에 있는 인원인 경우 사전 명부 카테고리로 보정
          var preservedCat = existing.category || cat;
          if (preservedCat === 'walkin' && rosterMatch && rosterMatch.category) {
            preservedCat = rosterMatch.category;
          }
          var preservedRegMethod = existing.regMethod || attendee.regMethod || (rosterMatch ? 'pre' : 'walkin');
          if (preservedRegMethod === 'walkin' && rosterMatch) {
            preservedRegMethod = 'pre';
          }
          var preservedType = isOp ? 'operator' : (preservedCat === 'external' || preservedCat === 'vip' || preservedCat === 'him' ? preservedCat : (rosterMatch ? 'pre_registered' : (existing.type || attendee.type || 'walkin')));
          var preservedDept = existing.dept || attendee.dept || (rosterMatch ? rosterMatch.dept : '');
          var preservedPos = existing.position || attendee.position || (rosterMatch ? (rosterMatch.position || rosterMatch.title || '') : '');

          var updated = Object.assign({}, attendee, existing, {
            seq: existing.seq,
            checkinId: existing.checkinId || ('HVAC-' + String(existing.seq).padStart(3, '0')),
            name: existing.name || attendee.name,
            email: existing.email || attendee.email,
            category: preservedCat,
            regMethod: preservedRegMethod,
            isOperator: isOp,
            type: preservedType,
            dept: preservedDept,
            position: preservedPos,
            sessionToken: newSessionToken,
            activeDeviceId: curDeviceId,
            activeDeviceType: getDeviceType(),
            checkedAt: nowEpoch,
            lastActiveAt: nowEpoch,
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

        // 2) 신규 체크인: 대역별(사전 1~199, 현장 201~299, 운영 301~499, 외부 501~699, VIP 701~799, 하이엠 901~999) ETag CAS 트랜잭션으로 원자적 순번 증가
        var baseOffset = 0;
        var counterSubPath = 'checkins/seqCounter';
        if (cat === 'walkin') {
          baseOffset = 200;
          counterSubPath = 'checkins/seqCounter_walkin';
        } else if (cat === 'operator') {
          baseOffset = 300;
          counterSubPath = 'checkins/seqCounter_operator';
        } else if (cat === 'external') {
          baseOffset = 500;
          counterSubPath = 'checkins/seqCounter_external';
        } else if (cat === 'vip') {
          baseOffset = 700;
          counterSubPath = 'checkins/seqCounter_vip';
        } else if (cat === 'him') {
          baseOffset = 900;
          counterSubPath = 'checkins/seqCounter_him';
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
          var savedM = read('hvac_milestone_events');
          var milestones = Array.isArray(savedM) ? savedM : DEFAULT_MILESTONES;
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

              var checkinType = isOp ? 'operator' : (rosterMatch ? (rosterMatch.type || 'pre_registered') : (attendee.type || 'walkin'));
              var position = attendee.position || (rosterMatch ? (rosterMatch.position || rosterMatch.title || '') : '');
              var dept = attendee.dept || (rosterMatch ? (rosterMatch.dept || '') : '');
              var empNo = attendee.empNo || (rosterMatch ? (rosterMatch.empNo || '') : '');
              var resolvedCat = attendee.category || (rosterMatch ? (rosterMatch.category || rosterMatch.regMethod) : cat);
              var resolvedReg = (attendee.regMethod === 'manual' || attendee.isManual) ? 'manual' : (rosterMatch ? 'pre' : (attendee.regMethod || 'walkin'));

              var record = Object.assign({}, attendee, {
                seq: seq,
                checkinId: 'HVAC-' + String(seq).padStart(3, '0'),
                cleanEmail: cleanEmail,
                category: resolvedCat,
                regMethod: resolvedReg,
                isOperator: isOp,
                type: checkinType,
                position: position,
                dept: dept,
                empNo: empNo,
                sessionToken: newSessionToken,
                activeDeviceId: getDeviceId(),
                activeDeviceType: getDeviceType(),
                checkedAt: Date.now(),
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

  var knownCheckinKeys = {};
  var hasSyncedCheckinKeysOnce = false;

  // 출석 목록 전체 클라우드 동기화 (관리자 수정/초기화 시, 동시 체크인 보존 병합 및 1.5초 중복 PUT 방지)
  function pushCheckinListToCloud(list, blocked) {
    // 동일 브라우저 내 열려 있는 다른 탭(사회자 럭키드로우 화면 등)에도 즉시 브로드캐스트!
    try { broadcastLocalKeyChange('hvac_checkin_list', list || []); } catch (e) {}
    var c = getCloudConfig();
    if (!c || !window.fetch) return Promise.resolve(false);
    var localArr = Array.isArray(list) ? list : [];

    function buildCheckinsPayload(mapObj, blockedArr) {
      var maxPre = 0;
      var maxWalkin = 200;
      var maxOp = 300;
      var maxExt = 500;
      var maxVip = 700;
      var maxHim = 900;
      Object.keys(mapObj).forEach(function (k) {
        var item = mapObj[k];
        if (!item) return;
        var s = Number(item.seq) || 0;
        if (s >= 900 && s < 1000 && s > maxHim) maxHim = s;
        else if (s >= 700 && s < 900 && s > maxVip) maxVip = s;
        else if (s >= 500 && s < 700 && s > maxExt) maxExt = s;
        else if (s >= 300 && s < 500 && s > maxOp) maxOp = s;
        else if (s >= 200 && s < 300 && s > maxWalkin) maxWalkin = s;
        else if (s > 0 && s < 200 && s > maxPre) maxPre = s;
      });
      var pBody = {
        items: mapObj,
        seqCounter: maxPre,
        seqCounter_walkin: maxWalkin,
        seqCounter_operator: maxOp,
        seqCounter_external: maxExt,
        seqCounter_vip: maxVip,
        seqCounter_him: maxHim
      };
      if (Array.isArray(blockedArr)) pBody.blocked = blockedArr;
      return pBody;
    }

    var itemsMap = {};
    localArr.forEach(function (item) {
      if (!item) return;
      var k = String(item.email || ('u_' + item.seq)).toLowerCase().replace('@lge.com', '').replace(/[.#$\[\]\/]/g, '_');
      itemsMap[k] = item;
    });

    // 전체 초기화(list가 빈 배열)인 경우 즉시 빈 상태로 PUT
    if (localArr.length === 0) {
      knownCheckinKeys = {};
      var emptyBody = buildCheckinsPayload({}, blocked);
      var emptyStr = JSON.stringify(emptyBody);
      lastPushedSectionMap['checkins'] = { body: emptyStr, ts: Date.now() };
      return fetch(cloudPath('checkins'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: emptyStr
      }).then(function (r) {
        if (r.ok) return touchCloudMeta('checkins').then(function () { return true; });
        return false;
      }).catch(function () { return false; });
    }

    // 개별 참석자 수정/추가/삭제 시: 서버 최신 /checkins.json을 먼저 읽어
    // 다른 기기에서 방금 새로 체크인했거나 로컬이 아직 동기화받지 못한 참석자가 덮어쓰기로 유실되지 않도록 병합 보호!
    return fetch(cloudPath('checkins'), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (remoteChk) {
        var mergedAdded = false;
        if (remoteChk && typeof remoteChk === 'object' && remoteChk.items && typeof remoteChk.items === 'object') {
          Object.keys(remoteChk.items).forEach(function (rk) {
            if (!itemsMap[rk] && remoteChk.items[rk]) {
              // 이전에 로컬에서 인지했던 참석자(knownCheckinKeys[rk])가 현재 list에 없다면 관리자가 의도적으로 삭제/강퇴한 것임
              var wasExplicitlyDeleted = hasSyncedCheckinKeysOnce && !!knownCheckinKeys[rk];
              if (!wasExplicitlyDeleted) {
                itemsMap[rk] = remoteChk.items[rk];
                mergedAdded = true;
              }
            }
          });
        }
        var nextKnown = {};
        Object.keys(itemsMap).forEach(function (k) { nextKnown[k] = true; });
        knownCheckinKeys = nextKnown;
        hasSyncedCheckinKeysOnce = true;

        if (mergedAdded) {
          var mergedArr = Object.values(itemsMap).filter(Boolean);
          mergedArr.sort(function (a, b) { return (b.seq || 0) - (a.seq || 0); });
          withCloudSyncLock(function () {
            writeLocalSilent('hvac_checkin_list', mergedArr);
            try { window.dispatchEvent(new CustomEvent('hvac:checkin-updated', { detail: { list: mergedArr } })); } catch (e) {}
            try { window.dispatchEvent(new StorageEvent('storage', { key: 'hvac_checkin_list' })); } catch (e) {}
          });
        }

        var finalBlocked = Array.isArray(blocked) ? blocked : (remoteChk && Array.isArray(remoteChk.blocked) ? remoteChk.blocked : []);
        var body = buildCheckinsPayload(itemsMap, finalBlocked);
        var bodyStr = JSON.stringify(body);
        var now = Date.now();
        var prev = lastPushedSectionMap['checkins'];
        if (prev && prev.body === bodyStr && (now - prev.ts < 2000)) {
          return true;
        }
        lastPushedSectionMap['checkins'] = { body: bodyStr, ts: now };

        return fetch(cloudPath('checkins'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: bodyStr
        }).then(function (r) {
          if (r.ok) return touchCloudMeta('checkins').then(function () { return true; });
          return false;
        });
      }).catch(function () { return false; });
  }

  // Q&A 질문 목록 클라우드 동기화 (isLiked 제거 후 정규화 및 즉시 전파)
  function pushQnaListToCloud(qList) {
    var cleanList = sanitizeQnaListForCloud(qList || []);
    var localList = cleanList.map(function (q) { return normalizeQnaItemForLocal(q); });
    try { broadcastLocalKeyChange('hvac_qna_list', localList); } catch (e) {}
    var c = getCloudConfig();
    if (!c || !window.fetch) return Promise.resolve(false);
    var bodyStr = JSON.stringify(cleanList);
    var now = Date.now();
    var prev = lastPushedSectionMap['qna'];
    if (prev && prev.body === bodyStr && (now - prev.ts < 800)) {
      return Promise.resolve(true);
    }
    lastPushedSectionMap['qna'] = { body: bodyStr, ts: now };

    return fetch(cloudPath('qna/list'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: bodyStr
    }).then(function (r) {
      if (r.ok) return touchCloudMeta('qna').then(function () { return true; });
      return false;
    }).catch(function () { return false; });
  }

  // Q&A 신규 질문 원자적 클라우드 병합 등록 (동시 질문 유실 방지 + ETag CAS 재시도)
  function addQnaQuestionToCloud(newQ) {
    if (!newQ || !newQ.id) return Promise.resolve(false);
    setQnaLikedState(newQ.id, true);
    var cleanNewQ = sanitizeQnaListForCloud([newQ])[0];

    // 1) 로컬 즉시 반영 및 동일 브라우저 탭 브로드캐스트
    var curLocal = read('hvac_qna_list') || [];
    if (!Array.isArray(curLocal)) curLocal = [];
    var existsLocally = curLocal.some(function (q) { return q && String(q.id) === String(cleanNewQ.id); });
    if (!existsLocally) curLocal.unshift(cleanNewQ);
    var normalizedLocal = curLocal.map(function (q) { return normalizeQnaItemForLocal(q); });
    withCloudSyncLock(function () {
      writeLocalSilent('hvac_qna_list', normalizedLocal);
      try { broadcastLocalKeyChange('hvac_qna_list', normalizedLocal); } catch (e) {}
      try { window.dispatchEvent(new CustomEvent('hvac:qna-updated', { detail: { list: normalizedLocal } })); } catch (e) {}
      try { window.dispatchEvent(new StorageEvent('storage', { key: 'hvac_qna_list' })); } catch (e) {}
    });

    var c = getCloudConfig();
    if (!c || !window.fetch) return Promise.resolve(true);

    var url = cloudPath('qna/list');
    function attemptAdd(tryCount) {
      return fetch(url, { headers: { 'X-Firebase-ETag': 'true' }, cache: 'no-store' })
        .then(function (res) {
          var etag = res.headers.get('ETag');
          return res.json().then(function (remoteList) {
            var list = Array.isArray(remoteList) ? remoteList.filter(Boolean) : [];
            var alreadyInRemote = list.some(function (q) { return q && String(q.id) === String(cleanNewQ.id); });
            if (!alreadyInRemote) {
              list.unshift(cleanNewQ);
            }
            var cleanRemote = sanitizeQnaListForCloud(list);
            var headers = { 'Content-Type': 'application/json' };
            if (etag) headers['If-Match'] = etag;
            return fetch(url, {
              method: 'PUT',
              headers: headers,
              body: JSON.stringify(cleanRemote)
            }).then(function (putRes) {
              if (putRes.status === 412 && tryCount < 4) {
                return attemptAdd(tryCount + 1);
              }
              var mergedLocal = cleanRemote.map(function (q) { return normalizeQnaItemForLocal(q); });
              withCloudSyncLock(function () {
                writeLocalSilent('hvac_qna_list', mergedLocal);
                try { broadcastLocalKeyChange('hvac_qna_list', mergedLocal); } catch (e) {}
                try { window.dispatchEvent(new CustomEvent('hvac:qna-updated', { detail: { list: mergedLocal } })); } catch (e) {}
                try { window.dispatchEvent(new StorageEvent('storage', { key: 'hvac_qna_list' })); } catch (e) {}
              });
              return touchCloudMeta('qna').then(function () { return true; });
            });
          });
        })
        .catch(function () {
          return pushQnaListToCloud(normalizedLocal);
        });
    }
    return attemptAdd(0);
  }

  // Q&A 공감(좋아요) 원자적 증감 클라우드 동기화 (다중 참석자 동시 클릭 시 카운트 누락/역전 완벽 방지)
  function toggleQnaLikeInCloud(qId, forceLikeState) {
    if (!qId) return Promise.resolve(null);
    var idStr = String(qId);
    var currentlyLiked = isQnaLiked(idStr);
    var nextLiked = (typeof forceLikeState === 'boolean') ? forceLikeState : !currentlyLiked;
    var delta = nextLiked ? 1 : -1;
    setQnaLikedState(idStr, nextLiked);

    // 1) 로컬 즉시 낙관적 업데이트 (UI 딜레이 0ms)
    var curLocal = read('hvac_qna_list') || [];
    if (!Array.isArray(curLocal)) curLocal = [];
    var targetLocal = curLocal.find(function (q) { return q && String(q.id) === idStr; });
    if (targetLocal) {
      targetLocal.likes = Math.max(0, (Number(targetLocal.likes) || 0) + delta);
      targetLocal.isLiked = nextLiked;
    }
    var normalizedLocal = curLocal.map(function (q) { return normalizeQnaItemForLocal(q); });
    withCloudSyncLock(function () {
      writeLocalSilent('hvac_qna_list', normalizedLocal);
      try { broadcastLocalKeyChange('hvac_qna_list', normalizedLocal); } catch (e) {}
      try { window.dispatchEvent(new CustomEvent('hvac:qna-updated', { detail: { list: normalizedLocal } })); } catch (e) {}
      try { window.dispatchEvent(new StorageEvent('storage', { key: 'hvac_qna_list' })); } catch (e) {}
    });

    var c = getCloudConfig();
    if (!c || !window.fetch) return Promise.resolve({ liked: nextLiked, likes: targetLocal ? targetLocal.likes : 0 });

    var url = cloudPath('qna/list');
    function attemptToggle(tryCount) {
      return fetch(url, { headers: { 'X-Firebase-ETag': 'true' }, cache: 'no-store' })
        .then(function (res) {
          var etag = res.headers.get('ETag');
          return res.json().then(function (remoteList) {
            var list = Array.isArray(remoteList) ? remoteList.filter(Boolean) : sanitizeQnaListForCloud(curLocal);
            var targetRemote = list.find(function (q) { return q && String(q.id) === idStr; });
            var updatedLikes = 0;
            if (targetRemote) {
              // 만약 원격에서 방금 로드한 경우 delta 반영 (tryCount === 0일 때는 원격 기준 + delta)
              targetRemote.likes = Math.max(0, (Number(targetRemote.likes) || 0) + delta);
              updatedLikes = targetRemote.likes;
            } else if (targetLocal) {
              var copyLocal = sanitizeQnaListForCloud([targetLocal])[0];
              list.unshift(copyLocal);
              updatedLikes = copyLocal.likes;
            }
            var cleanRemote = sanitizeQnaListForCloud(list);
            var headers = { 'Content-Type': 'application/json' };
            if (etag) headers['If-Match'] = etag;
            return fetch(url, {
              method: 'PUT',
              headers: headers,
              body: JSON.stringify(cleanRemote)
            }).then(function (putRes) {
              if (putRes.status === 412 && tryCount < 4) {
                return attemptToggle(tryCount + 1);
              }
              var mergedLocal = cleanRemote.map(function (q) { return normalizeQnaItemForLocal(q); });
              withCloudSyncLock(function () {
                writeLocalSilent('hvac_qna_list', mergedLocal);
                try { broadcastLocalKeyChange('hvac_qna_list', mergedLocal); } catch (e) {}
                try { window.dispatchEvent(new CustomEvent('hvac:qna-updated', { detail: { list: mergedLocal } })); } catch (e) {}
                try { window.dispatchEvent(new StorageEvent('storage', { key: 'hvac_qna_list' })); } catch (e) {}
              });
              return touchCloudMeta('qna').then(function () {
                return { liked: nextLiked, likes: updatedLikes };
              });
            });
          });
        })
        .catch(function () {
          return pushQnaListToCloud(normalizedLocal).then(function () {
            return { liked: nextLiked, likes: targetLocal ? targetLocal.likes : 0 };
          });
        });
    }
    return attemptToggle(0);
  }

  var isPushingQuizScore = false;

  // 퀴즈 점수 클라우드 전송 (다중 기기 동시 제출 잠금 & 최초 제출자 First-Write-Wins 보장)
  function pushQuizScoreToCloud(scoreObj) {
    var c = getCloudConfig();
    if (!c || !window.fetch || !scoreObj) return Promise.resolve({ success: false });
    var user = read('hvac_user_checked') || {};
    var key = String(user.email || scoreObj.deviceId || 'anon_' + Date.now()).toLowerCase().replace('@lge.com', '').replace(/[.#$\[\]\/]/g, '_');
    var subUrl = cloudPath('quiz/submissions/' + key);
    isPushingQuizScore = true;

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
          sessionScores: scoreObj.sessionScores || {},
          sessionAnswered: scoreObj.sessionAnswered || {},
          answers: scoreObj.answers || {},
          deviceId: myDeviceId,
          isLocked: (scoreObj.answeredCount >= (scoreObj.total || 6)),
          updatedAt: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
          timestamp: Date.now()
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
      .catch(function () { return { success: false }; })
      .finally(function () { isPushingQuizScore = false; });
  }

  // 미니게임 초경량 Top 3 요약 데이터(~450B) 생성 헬퍼
  function buildGameTop3SummaryFromList(list) {
    var arr = Array.isArray(list) ? list : [];
    var valid10s = arr.filter(function (it) { return it && it.game10s && it.game10s.bestDiff !== null && it.game10s.bestDiff !== undefined; });
    valid10s.sort(function (a, b) {
      if (a.game10s.bestDiff !== b.game10s.bestDiff) return a.game10s.bestDiff - b.game10s.bestDiff;
      return (a.game10s.bestTime || 0) - (b.game10s.bestTime || 0);
    });
    var valid26c = arr.filter(function (it) { return it && it.game26c && it.game26c.bestDiff !== null && it.game26c.bestDiff !== undefined; });
    valid26c.sort(function (a, b) {
      if (a.game26c.bestDiff !== b.game26c.bestDiff) return a.game26c.bestDiff - b.game26c.bestDiff;
      return (a.game26c.bestTemp || 0) - (b.game26c.bestTemp || 0);
    });
    return {
      top10s: valid10s.slice(0, 3).map(function (it) {
        return {
          key: it.key,
          name: it.name || '참가자',
          dept: it.dept || '',
          game10s: { bestTime: it.game10s.bestTime, bestDiff: it.game10s.bestDiff, isPerfect: !!it.game10s.isPerfect }
        };
      }),
      top26c: valid26c.slice(0, 3).map(function (it) {
        return {
          key: it.key,
          name: it.name || '참가자',
          dept: it.dept || '',
          game26c: { bestTemp: it.game26c.bestTemp, bestDiff: it.game26c.bestDiff, isPerfect: !!it.game26c.isPerfect }
        };
      }),
      count10s: valid10s.length,
      count26c: valid26c.length,
      updatedAt: Date.now()
    };
  }

  function mergeSummaryToCompactList(summary) {
    if (!summary || typeof summary !== 'object') return [];
    var map = {};
    (summary.top10s || []).forEach(function (it) {
      if (!it || !it.key) return;
      map[it.key] = { key: it.key, name: it.name, dept: it.dept, game10s: it.game10s };
    });
    (summary.top26c || []).forEach(function (it) {
      if (!it || !it.key) return;
      if (map[it.key]) map[it.key].game26c = it.game26c;
      else map[it.key] = { key: it.key, name: it.name, dept: it.dept, game26c: it.game26c };
    });
    return Object.values(map);
  }

  // 점심 미니게임 (10초 / 20℃) 결과 클라우드 전송 + 초경량 Top 3(games/top3) 갱신
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
        var isNew10s = (!existing || !existing.game10s || existing.game10s.bestDiff === null || existing.game10s.bestDiff === undefined) && (gameData.game10s && gameData.game10s.bestDiff !== null && gameData.game10s.bestDiff !== undefined);
        var isNew26c = (!existing || !existing.game26c || existing.game26c.bestDiff === null || existing.game26c.bestDiff === undefined) && (gameData.game26c && gameData.game26c.bestDiff !== null && gameData.game26c.bestDiff !== undefined);
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
          if (!r.ok) return { success: false };
          // 초경량 Top 3 노드(~450B)만 읽어서 Top 3 변동 또는 참여자수 증감 시 갱신
          return fetch(cloudPath('games/top3'), { cache: 'no-store' })
            .then(function (tr) { return tr.ok ? tr.json() : null; })
            .then(function (top3Obj) {
              if (!top3Obj || typeof top3Obj !== 'object') {
                top3Obj = { top10s: [], top26c: [], count10s: 0, count26c: 0, updatedAt: Date.now() };
              }
              var top10s = Array.isArray(top3Obj.top10s) ? top3Obj.top10s.filter(function (x) { return x && x.key !== key; }) : [];
              var top26c = Array.isArray(top3Obj.top26c) ? top3Obj.top26c.filter(function (x) { return x && x.key !== key; }) : [];
              if (merged.game10s && merged.game10s.bestDiff !== null && merged.game10s.bestDiff !== undefined) {
                top10s.push({
                  key: key,
                  name: merged.name,
                  dept: merged.dept,
                  game10s: { bestTime: merged.game10s.bestTime, bestDiff: merged.game10s.bestDiff, isPerfect: !!merged.game10s.isPerfect }
                });
                top10s.sort(function (a, b) {
                  if (a.game10s.bestDiff !== b.game10s.bestDiff) return a.game10s.bestDiff - b.game10s.bestDiff;
                  return (a.game10s.bestTime || 0) - (b.game10s.bestTime || 0);
                });
                top10s = top10s.slice(0, 3);
              }
              if (merged.game26c && merged.game26c.bestDiff !== null && merged.game26c.bestDiff !== undefined) {
                top26c.push({
                  key: key,
                  name: merged.name,
                  dept: merged.dept,
                  game26c: { bestTemp: merged.game26c.bestTemp, bestDiff: merged.game26c.bestDiff, isPerfect: !!merged.game26c.isPerfect }
                });
                top26c.sort(function (a, b) {
                  if (a.game26c.bestDiff !== b.game26c.bestDiff) return a.game26c.bestDiff - b.game26c.bestDiff;
                  return (a.game26c.bestTemp || 0) - (b.game26c.bestTemp || 0);
                });
                top26c = top26c.slice(0, 3);
              }
              var prevJson = JSON.stringify({ t10: top3Obj.top10s || [], t26: top3Obj.top26c || [], c10: top3Obj.count10s || 0, c26: top3Obj.count26c || 0 });
              var nextSummary = {
                top10s: top10s,
                top26c: top26c,
                count10s: Math.max(top10s.length, (Number(top3Obj.count10s) || 0) + (isNew10s ? 1 : 0)),
                count26c: Math.max(top26c.length, (Number(top3Obj.count26c) || 0) + (isNew26c ? 1 : 0)),
                updatedAt: Date.now()
              };
              var nextJson = JSON.stringify({ t10: nextSummary.top10s, t26: nextSummary.top26c, c10: nextSummary.count10s, c26: nextSummary.count26c });
              writeLocalSilent('hvac_game_top3', nextSummary);
              if (prevJson === nextJson) {
                return { success: true, record: merged, summary: nextSummary };
              }
              return fetch(cloudPath('games/top3'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(nextSummary)
              }).then(function () {
                return touchCloudMeta('games').then(function () { return { success: true, record: merged, summary: nextSummary }; });
              });
            });
        });
      })
      .catch(function () { return { success: false }; });
  }

  // 전광판(game-leaderboard.html) 및 모바일 게임(game.html) 전용 초경량 Top 3 조회 (~450B)
  function fetchGameTop3FromCloud() {
    var c = getCloudConfig();
    if (!c || !window.fetch) return Promise.resolve({ top10s: [], top26c: [], count10s: 0, count26c: 0 });
    return fetch(cloudPath('games/top3'), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (top3Obj) {
        if (top3Obj && typeof top3Obj === 'object' && (Array.isArray(top3Obj.top10s) || Array.isArray(top3Obj.top26c))) {
          writeLocalSilent('hvac_game_top3', top3Obj);
          var compactList = mergeSummaryToCompactList(top3Obj);
          if (pageId() !== 'admin') {
            writeLocalSilent('hvac_game_submissions', compactList);
          }
          return top3Obj;
        }
        // 만약 클라우드에 아직 games/top3 노드가 없다면 1회 한정으로 submissions에서 생성 후 캐싱
        return fetch(cloudPath('games/submissions'), { cache: 'no-store' })
          .then(function (sr) { return sr.ok ? sr.json() : null; })
          .then(function (subMap) {
            var list = (subMap && typeof subMap === 'object') ? Object.values(subMap).filter(Boolean) : [];
            var summary = buildGameTop3SummaryFromList(list);
            writeLocalSilent('hvac_game_top3', summary);
            if (pageId() !== 'admin') {
              writeLocalSilent('hvac_game_submissions', mergeSummaryToCompactList(summary));
            }
            fetch(cloudPath('games/top3'), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(summary)
            }).catch(function () {});
            return summary;
          });
      })
      .catch(function () {
        return read('hvac_game_top3') || { top10s: [], top26c: [], count10s: 0, count26c: 0 };
      });
  }

  function fetchGameSubmissionsFromCloud() {
    var c = getCloudConfig();
    if (!c || !window.fetch) return Promise.resolve([]);
    // 일반 참가자/리더보드 화면에서 호출 시 55KB 전체 목록 대신 450B Top 3 요약본만 반환하여 트래픽 99.2% 절감
    if (pageId() !== 'admin') {
      return fetchGameTop3FromCloud().then(function (summary) {
        return mergeSummaryToCompactList(summary);
      });
    }
    return fetch(cloudPath('games/submissions'), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (subMap) {
        if (!subMap || typeof subMap !== 'object') return [];
        var list = Object.values(subMap).filter(Boolean);
        writeLocalSilent('hvac_game_submissions', list);
        var summary = buildGameTop3SummaryFromList(list);
        writeLocalSilent('hvac_game_top3', summary);
        return list;
      })
      .catch(function () { return []; });
  }

  function resetGameSubmissionsOnCloud() {
    var c = getCloudConfig();
    if (!c || !window.fetch) return Promise.resolve(false);
    var emptySummary = { top10s: [], top26c: [], count10s: 0, count26c: 0, updatedAt: Date.now() };
    return Promise.all([
      fetch(cloudPath('games/submissions'), { method: 'DELETE' }),
      fetch(cloudPath('games/top3'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(emptySummary)
      })
    ]).then(function () {
      writeLocalSilent('hvac_game_submissions', []);
      writeLocalSilent('hvac_game_top3', emptySummary);
      return touchCloudMeta('games').then(function () { return true; });
    }).catch(function () { return false; });
  }

  // 개별 섹션 핀포인트 초고속 동기화 (SSE 스트림 이벤트 수신 시 즉시 호출)
  function syncSpecificSection(secName, forceAdminSync) {
    var pId = pageId();
    if (secName === 'quiz') {
      if (pId === 'quiz-winners' || pId === 'admin') {
        return fetch(cloudPath('quiz/submissions'), { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : undefined; })
          .then(function (subMap) {
            if (subMap === undefined) return false;
            var list = [];
            if (subMap && typeof subMap === 'object') {
              list = Object.values(subMap).filter(Boolean);
            }
            withCloudSyncLock(function () {
              writeLocalSilent('hvac_quiz_submissions', list);
              try { window.dispatchEvent(new CustomEvent('hvac:quiz-submissions-updated', { detail: { submissions: list } })); } catch (e) {}
              try { window.dispatchEvent(new StorageEvent('storage', { key: 'hvac_quiz_submissions' })); } catch (e) {}
            });
            return true;
          }).catch(function () { return false; });
      } else if (pId === 'quiz') {
        var myQuizUser = read('hvac_user_checked');
        if (myQuizUser && myQuizUser.email) {
          var myQKey = String(myQuizUser.email).toLowerCase().replace('@lge.com', '').replace(/[.#$\[\]\/]/g, '_');
          return fetch(cloudPath('quiz/submissions/' + myQKey), { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : undefined; })
            .then(function (mySub) {
              if (mySub === undefined) return false;
              withCloudSyncLock(function () {
                if (mySub === null) {
                  if (!isPushingQuizScore) {
                    var localAns = read('hvac_quiz_answers');
                    if (localAns && typeof localAns === 'object' && Object.keys(localAns).length > 0) {
                      try { localStorage.removeItem('hvac_quiz_answers'); } catch (e) {}
                      writeLocalSilent('hvac_quiz_score', '0');
                      try { window.dispatchEvent(new CustomEvent('hvac:quiz-reset', { detail: { resetAt: Date.now() } })); } catch (e) {}
                    }
                  }
                } else if (mySub && typeof mySub === 'object' && mySub.answers && typeof mySub.answers === 'object') {
                  var localAnsCur = read('hvac_quiz_answers') || {};
                  var remoteKeys = Object.keys(mySub.answers);
                  var localKeys = Object.keys(localAnsCur);
                  if (remoteKeys.length > localKeys.length) {
                    writeLocalSilent('hvac_quiz_answers', mySub.answers);
                    writeLocalSilent('hvac_quiz_score', String(mySub.score || 0));
                    try { window.dispatchEvent(new CustomEvent('hvac:quiz-my-submission-updated', { detail: { submission: mySub } })); } catch (e) {}
                  }
                }
              });
              return true;
            }).catch(function () { return false; });
        }
        return Promise.resolve(true);
      }
    } else if (secName === 'checkins') {
      var fullCheckinPages = ['admin', 'attendance-dashboard', 'luckydraw-stage', 'quiz-winners'];
      if (fullCheckinPages.indexOf(pId) >= 0) {
        return fetch(cloudPath('checkins'), { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : undefined; })
          .then(function (chkData) {
            if (chkData === undefined) return false;
            var arr = [];
            var nextKnown = {};
            if (chkData && typeof chkData === 'object' && chkData.items && typeof chkData.items === 'object') {
              Object.keys(chkData.items).forEach(function (k) {
                if (chkData.items[k]) nextKnown[k] = true;
              });
              arr = Object.values(chkData.items).filter(Boolean);
              arr.sort(function (a, b) { return (b.seq || 0) - (a.seq || 0); });
            }
            knownCheckinKeys = nextKnown;
            hasSyncedCheckinKeysOnce = true;

            var prevArrRaw = null;
            try { prevArrRaw = localStorage.getItem('hvac_checkin_list'); } catch (e) {}
            var nextArrRaw = JSON.stringify(arr);
            var isCheckinChanged = (prevArrRaw !== nextArrRaw);

            var nextBlocked = (chkData && Array.isArray(chkData.blocked)) ? chkData.blocked : [];
            var prevBlockedRaw = null;
            try { prevBlockedRaw = localStorage.getItem('hvac_blocked_users'); } catch (e) {}
            var isBlockedChanged = (prevBlockedRaw !== JSON.stringify(nextBlocked));

            withCloudSyncLock(function () {
              writeLocalSilent('hvac_checkin_list', arr);
              writeLocalSilent('hvac_blocked_users', nextBlocked);
              if (isCheckinChanged || isBlockedChanged || forceAdminSync) {
                try { window.dispatchEvent(new CustomEvent('hvac:checkin-updated', { detail: { list: arr } })); } catch (e) {}
                try { window.dispatchEvent(new StorageEvent('storage', { key: 'hvac_checkin_list' })); } catch (e) {}
              }
              if (isBlockedChanged) {
                try { window.dispatchEvent(new StorageEvent('storage', { key: 'hvac_blocked_users' })); } catch (e) {}
              }
            });
            return true;
          }).catch(function () { return false; });
      } else {
        // 일반 참석자는 본인 계정 상태(~200B)만 핀포인트 확인하여 개인정보 보호 및 99.7% 트래픽 절감
        var myUser = read('hvac_user_checked');
        if (myUser && myUser.email) {
          var myClean = String(myUser.email).toLowerCase().replace('@lge.com', '').replace(/[.#$\[\]\/]/g, '_');
          return fetch(cloudPath('checkins/items/' + myClean), { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : undefined; })
            .then(function (serverUser) {
              if (serverUser === undefined) return false;
              withCloudSyncLock(function () {
                if (!serverUser || typeof serverUser !== 'object') {
                  writeLocalSilent('hvac_user_checked', null);
                  try { localStorage.removeItem('hvac_user_checked'); } catch (e) {}
                  try { localStorage.removeItem('hvac_checkin_user'); } catch (e) {}
                  window.dispatchEvent(new CustomEvent('hvac:session-terminated', {
                    detail: { deviceType: '출석부 초기화 / 세션 만료', terminatedAt: Date.now() }
                  }));
                  return;
                }
                if (serverUser.sessionToken && myUser.sessionToken && serverUser.sessionToken !== myUser.sessionToken) {
                  writeLocalSilent('hvac_user_checked', null);
                  try { localStorage.removeItem('hvac_user_checked'); } catch (e) {}
                  try { localStorage.removeItem('hvac_checkin_user'); } catch (e) {}
                  window.dispatchEvent(new CustomEvent('hvac:session-terminated', {
                    detail: { deviceType: serverUser.activeDeviceType || '다른 기기', terminatedAt: serverUser.lastActiveAt || Date.now() }
                  }));
                  return;
                }
                if (serverUser.giftStatus && myUser.giftStatus !== serverUser.giftStatus) {
                  myUser.giftStatus = serverUser.giftStatus;
                  writeLocalSilent('hvac_user_checked', myUser);
                  window.dispatchEvent(new StorageEvent('storage', { key: 'hvac_user_checked' }));
                }
              });
              return true;
            }).catch(function () { return false; });
        }
        return Promise.resolve(true);
      }
    } else if (secName === 'qna') {
      if (forceAdminSync || pId === 'qna' || pId === 'admin') {
        return fetch(cloudPath('qna/list'), { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : undefined; })
          .then(function (remoteQna) {
            if (remoteQna === undefined) return false;
            // Firebase에서 빈 배열이 null로 반환되는 경우 빈 배열([])로 정상 처리 (전체 삭제/초기화 즉시 반영)
            var remoteList = Array.isArray(remoteQna) ? remoteQna.filter(Boolean) : [];
            var likedMap = getLikedQnaMap();
            var normalizedList = remoteList.map(function (q) {
              return normalizeQnaItemForLocal(q, likedMap);
            });
            withCloudSyncLock(function () {
              writeLocalSilent('hvac_qna_list', normalizedList);
              try { window.dispatchEvent(new CustomEvent('hvac:qna-updated', { detail: { list: normalizedList } })); } catch (e) {}
              try { window.dispatchEvent(new StorageEvent('storage', { key: 'hvac_qna_list' })); } catch (e) {}
            });
            return true;
          }).catch(function () { return false; });
      }
    } else if (secName === 'games') {
      if (pId === 'lunch-screen' || pId === 'game-leaderboard') {
        // 전광판은 55KB 전체 목록 대신 450B 초경량 Top 3 노드만 조회
        return fetchGameTop3FromCloud().then(function (summary) {
          var compactList = mergeSummaryToCompactList(summary);
          withCloudSyncLock(function () {
            window.dispatchEvent(new CustomEvent('hvac:games-updated', { detail: { submissions: compactList, summary: summary } }));
            window.dispatchEvent(new StorageEvent('storage', { key: 'hvac_game_submissions' }));
          });
          return true;
        }).catch(function () { return false; });
      } else if (pId === 'admin' || forceAdminSync) {
        return fetch(cloudPath('games/submissions'), { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : undefined; })
          .then(function (subMap) {
            if (subMap === undefined) return false;
            var list = (subMap && typeof subMap === 'object') ? Object.values(subMap).filter(Boolean) : [];
            var summary = buildGameTop3SummaryFromList(list);
            withCloudSyncLock(function () {
              writeLocalSilent('hvac_game_submissions', list);
              writeLocalSilent('hvac_game_top3', summary);
              window.dispatchEvent(new CustomEvent('hvac:games-updated', { detail: { submissions: list, summary: summary } }));
              window.dispatchEvent(new StorageEvent('storage', { key: 'hvac_game_submissions' }));
            });
            return true;
          }).catch(function () { return false; });
      }
    } else if (secName === 'surveys') {
      if (pId === 'admin' || pId === 'luckydraw-stage' || forceAdminSync) {
        return fetch(cloudPath('surveys'), { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : undefined; })
          .then(function (survMap) {
            if (survMap === undefined) return false;
            var list = (survMap && typeof survMap === 'object') ? Object.values(survMap).filter(Boolean) : [];
            withCloudSyncLock(function () {
              writeLocalSilent('hvac_survey_responses', list);
              window.dispatchEvent(new StorageEvent('storage', { key: 'hvac_survey_responses' }));
            });
            return true;
          }).catch(function () { return false; });
      }
    } else if (secName === 'config') {
      return syncConfigSmart(null, false);
    }
    return Promise.resolve(false);
  }

  // 진행 중인 섹션 네트워크 요청 중복 차단 및 성공 시점에 lastSeenMeta 확정
  function requestSectionSync(sec, remoteTsVal, forceAdminSync) {
    var curPid = pageId();
    if (!forceAdminSync && !doesPageUseSection(sec, curPid)) return Promise.resolve(false);
    var seenKey = getSectionSeenKey(sec, curPid);
    var targetTs = Number(remoteTsVal) || -1;
    if (inFlightSectionPromises[seenKey]) {
      return inFlightSectionPromises[seenKey];
    }
    var p = syncSpecificSection(sec, !!forceAdminSync)
      .then(function (ok) {
        if (ok) {
          lastSeenMeta[seenKey] = targetTs;
        }
        return ok;
      })
      .finally(function () {
        delete inFlightSectionPromises[seenKey];
      });
    inFlightSectionPromises[seenKey] = p;
    return p;
  }

  function isConfigKeyNeededOnPage(key, pId) {
    if (pId === 'admin') return true;
    if (key === 'hvac_super_admin_hash') return false;
    if (key === 'hvac_checkin_passcode' || key === 'hvac_roster_list') return pId === 'checkin';
    if (key === 'hvac_quiz_unlocked_sessions' || key === 'hvac_quiz_config' || key === 'hvac_quiz_scoring_policy') {
      return pId === 'quiz' || pId === 'checkin' || pId === 'quiz-winners';
    }
    if (key === 'hvac_game_config') {
      return pId === 'game' || pId === 'game-leaderboard' || pId === 'lunch-screen' || pId === 'checkin';
    }
    if (key === 'hvac_survey_config') {
      return pId === 'survey' || pId === 'checkin';
    }
    if (key === 'hvac_milestone_events') {
      return pId === 'checkin' || pId === 'attendance-dashboard' || pId === 'luckydraw-stage';
    }
    if (key === 'hvac_luckydraw_config' || key === 'hvac_luckydraw_state') {
      return pId === 'admin' || pId === 'luckydraw-stage';
    }
    return true;
  }

  function syncSingleConfigKey(key) {
    if (!key || CONFIG_KEYS.indexOf(key) < 0) return Promise.resolve(false);
    var pId = pageId();
    if (!isConfigKeyNeededOnPage(key, pId)) return Promise.resolve(true);

    return fetch(cloudPath('config/' + key), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : undefined; })
      .then(function (val) {
        if (val === undefined) return false;
        // 핵심 패치: Firebase RTDB에서 빈 객체({}) PUT 시 노드가 삭제되어 null이 반환되는 경우,
        // hvac_luckydraw_state는 무시하지 않고 빈 초기 상태로 즉시 덮어써서 이전 2등/3등 잔여 캐시를 완벽히 리셋함!
        if (val === null) {
          if (key === 'hvac_luckydraw_state') {
            val = { drawnTiers: {}, confirmedTiers: {}, deliveredMilestones: {}, updatedAt: Date.now() };
          } else if (key === 'hvac_milestone_events') {
            val = [];
          } else {
            return false;
          }
        } else if (key === 'hvac_luckydraw_state') {
          val = normalizeLuckyDrawState(val);
        }
        var prevRaw = null;
        try { prevRaw = localStorage.getItem(key); } catch (e) {}
        var nextRaw = typeof val === 'string' ? val : JSON.stringify(val);
        withCloudSyncLock(function () {
          writeLocalSilent(key, val);
          if (prevRaw !== nextRaw) {
            refreshCommon();
            notifyUpdated([key]);
            try { window.dispatchEvent(new StorageEvent('storage', { key: key })); } catch (e) {}
          }
        });
        return true;
      }).catch(function () { return false; });
  }

  function syncConfigSmart(configKeyHint, forceAll) {
    var pId = pageId();
    // 1) 특정 단일 설정 키만 변경된 경우 (예: 세션별 퀴즈 오픈 hvac_quiz_unlocked_sessions ~5B)
    // 전체 config(12.2KB) 대신 해당 단일 키만 핀포인트 다운로드 (99.9% 트래픽 절감)
    if (!forceAll && hasLocalSectionCache('config') && configKeyHint && configKeyHint !== 'all' && CONFIG_KEYS.indexOf(configKeyHint) >= 0) {
      return syncSingleConfigKey(configKeyHint);
    }

    // 2) 이미 정적 스케줄/퀴즈/설문 설정(site-config.json)이 로컬에 캐시된 경우 (관리자 포함)
    // 무거운 정적 데이터(11.5KB)를 다시 받지 않고 동적 제어 키만 핀포인트 조회
    if (!forceAll && hasLocalSectionCache('config') && configKeyHint !== 'all') {
      var dynamicKeys = ['hvac_schedule_settings', 'hvac_quiz_unlocked_sessions', 'hvac_quiz_scoring_policy', 'hvac_notice_banner', 'hvac_game_config', 'hvac_checkin_passcode', 'hvac_luckydraw_config', 'hvac_luckydraw_state', 'hvac_milestone_events'];
      var needed = dynamicKeys.filter(function (k) { return isConfigKeyNeededOnPage(k, pId); });
      return Promise.all(needed.map(syncSingleConfigKey)).then(function () { return true; });
    }

    // 3) 관리자 전체 강제 동기화 또는 로컬 캐시가 전혀 없는 경우 전체 config 조회
    return fetch(cloudPath('config'), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfgData) {
        if (!cfgData || typeof cfgData !== 'object') cfgData = {};
        withCloudSyncLock(function () {
          var changedKeys = [];
          CONFIG_KEYS.forEach(function (k) {
            if (cfgData[k] !== undefined && cfgData[k] !== null) {
              var v = (k === 'hvac_luckydraw_state') ? normalizeLuckyDrawState(cfgData[k]) : cfgData[k];
              writeLocalSilent(k, v);
              changedKeys.push(k);
            } else if (k === 'hvac_luckydraw_state' && isConfigKeyNeededOnPage(k, pId)) {
              // 클라우드 config에서 hvac_luckydraw_state가 비어 삭제(null/undefined)된 상태라면 로컬도 즉시 초기화!
              var emptyState = { drawnTiers: {}, confirmedTiers: {}, deliveredMilestones: {}, updatedAt: Date.now() };
              writeLocalSilent(k, emptyState);
              changedKeys.push(k);
            }
          });
          if (changedKeys.length) {
            refreshCommon();
            notifyUpdated(changedKeys);
            changedKeys.forEach(function (k) {
              try { window.dispatchEvent(new StorageEvent('storage', { key: k })); } catch (e) {}
            });
          }
        });
        return true;
      }).catch(function () { return false; });
  }

  // meta 스냅샷/패치에서 설정 키별 타임스탬프 맵 추출 (중첩 객체 / 'config_keys/xxx' 평탄화 키 모두 지원)
  function extractCfgKeysMap(d) {
    var map = {};
    if (!d || typeof d !== 'object') return map;
    if (d.config_keys && typeof d.config_keys === 'object') {
      Object.keys(d.config_keys).forEach(function (k) { map[k] = d.config_keys[k]; });
    }
    Object.keys(d).forEach(function (k) {
      if (k.indexOf('config_keys/') === 0) map[k.slice(12)] = d[k];
    });
    return map;
  }

  // 설정 키별 타임스탬프 비교 후 실제로 변경된(그리고 현재 페이지에 필요한) 키만 다운로드
  function syncConfigFromMeta(d, forceAll) {
    var pId = pageId();
    var cfgMap = extractCfgKeysMap(d);
    var mapKeys = Object.keys(cfgMap);

    if (forceAll || !hasLocalSectionCache('config')) {
      mapKeys.forEach(function (k) {
        var ts = Number(cfgMap[k]) || 0;
        if (ts > 0) setCfgKeySeenTs(k, ts);
      });
      saveSeenCfgKeys();
      return syncConfigSmart(null, !!forceAll);
    }

    if (mapKeys.length > 0) {
      var allTs = Number(cfgMap.all) || 0;
      if (allTs > 0 && allTs !== (Number(lastSeenCfgKeys.all) || 0)) {
        lastSeenCfgKeys.all = allTs;
        mapKeys.forEach(function (k) {
          var ts = Number(cfgMap[k]) || 0;
          if (ts > 0) setCfgKeySeenTs(k, ts);
        });
        saveSeenCfgKeys();
        return syncConfigSmart(null, true);
      }
      var targets = [];
      var staticChanged = false;
      mapKeys.forEach(function (k) {
        if (k === 'all' || CONFIG_KEYS.indexOf(k) < 0) return;
        var ts = Number(cfgMap[k]) || 0;
        if (ts <= 0) return;
        if (!isConfigKeyNeededOnPage(k, pId)) return;
        var seenTs = getCfgKeySeenTs(k);
        // 정적 배포 키는 site-config.json의 metaConfigTs보다 클 때만 동기화하고,
        // 동적 실시간 키는 세션 인메모리 seenTs와 다르면(페이지 로드 시 0이므로 1회 검증 포함) 즉시 동기화!
        if (STATIC_PUBLISHED_KEYS.indexOf(k) >= 0) {
          if (ts <= seenTs) return;
          staticChanged = true;
        } else {
          if (ts === seenTs) return;
        }
        setCfgKeySeenTs(k, ts);
        targets.push(k);
      });
      if (staticChanged) saveSeenCfgKeys();
      return Promise.all(targets.map(syncSingleConfigKey)).then(function () { return true; });
    }

    // 구버전 meta (config_keys 없음): 마지막 변경 키 힌트로 동기화
    return syncConfigSmart(d && d.config_key ? d.config_key : null, false);
  }

  // =========================================================
  // 실시간 스트림 소켓 (Firebase RTDB Server-Sent Events / EventSource)
  // 200명 전원(참석자/운영자) 0초 지연 실시간 Push 소켓 영구 연결 유지
  // =========================================================
  var cloudEventSource = null;
  var streamConnected = false;

  function checkSessionResetSignal(resetEpochVal) {
    var resetEpoch = Number(resetEpochVal) || 0;
    if (resetEpoch <= 0) return;
    var myUser = read('hvac_user_checked');
    if (myUser && myUser.email) {
      var userCheckedEpoch = Math.max(Number(myUser.checkedAt) || 0, Number(myUser.lastActiveAt) || 0, Number(myUser.checkinTimeMs) || 0);
      if (userCheckedEpoch < resetEpoch) {
        withCloudSyncLock(function () {
          writeLocalSilent('hvac_user_checked', null);
          try { localStorage.removeItem('hvac_user_checked'); } catch (e) {}
          try { localStorage.removeItem('hvac_checkin_user'); } catch (e) {}
          window.dispatchEvent(new CustomEvent('hvac:session-terminated', {
            detail: { deviceType: '관리자 전체 세션 강제 체크아웃', terminatedAt: resetEpoch }
          }));
        });
      }
    }
  }

  function checkQuizResetSignal(resetEpochVal) {
    var resetEpoch = Number(resetEpochVal) || 0;
    if (resetEpoch <= 0) return;
    var prevReset = Number(lastSeenMeta.quiz_reset_at) || 0;
    if (resetEpoch > prevReset) {
      lastSeenMeta.quiz_reset_at = resetEpoch;
      saveLastSeenMeta();
      withCloudSyncLock(function () {
        writeLocalSilent('hvac_quiz_submissions', []);
        try { localStorage.removeItem('hvac_quiz_answers'); } catch (e) {}
        writeLocalSilent('hvac_quiz_score', '0');
        try { window.dispatchEvent(new CustomEvent('hvac:quiz-reset', { detail: { resetAt: resetEpoch } })); } catch (e) {}
        try { window.dispatchEvent(new CustomEvent('hvac:quiz-submissions-updated', { detail: { submissions: [] } })); } catch (e) {}
        try { window.dispatchEvent(new StorageEvent('storage', { key: 'hvac_quiz_submissions' })); } catch (e) {}
      });
    }
  }

  function initCloudStream() {
    if (typeof window === 'undefined' || !window.EventSource) return;
    var c = getCloudConfig();
    if (!c || !c.enabled || !c.dbUrl) return;

    if (window.__hvacCloudEventSource) {
      try { window.__hvacCloudEventSource.close(); } catch (e) {}
      window.__hvacCloudEventSource = null;
    }
    if (cloudEventSource) {
      try { cloudEventSource.close(); } catch (e) {}
      cloudEventSource = null;
    }

    var streamUrl = cloudPath('meta');
    try {
      cloudEventSource = new EventSource(streamUrl);
      window.__hvacCloudEventSource = cloudEventSource;

      function handleStreamPayload(payload) {
        if (!payload || typeof payload !== 'object') return;
        var p = payload.path || '';
        var d = payload.data;
        var curPid = pageId();

        if (p === '/' || p === '') {
          if (d && typeof d === 'object') {
            var metaChanged = false;
            if (d.session_reset_at && d.session_reset_at !== lastSeenMeta.session_reset_at) {
              lastSeenMeta.session_reset_at = d.session_reset_at;
              metaChanged = true;
              checkSessionResetSignal(d.session_reset_at);
            }
            if (d.quiz_reset_at && d.quiz_reset_at !== lastSeenMeta.quiz_reset_at) {
              checkQuizResetSignal(d.quiz_reset_at);
            }
            var streamCfgMap = extractCfgKeysMap(d);
            var streamHasChangedCfg = false;
            var streamKeys = Object.keys(streamCfgMap);
            for (var si = 0; si < streamKeys.length; si++) {
              var sk = streamKeys[si];
              var sts = Number(streamCfgMap[sk]) || 0;
              if (sts > 0 && sts !== getCfgKeySeenTs(sk) && isConfigKeyNeededOnPage(sk, curPid)) {
                streamHasChangedCfg = true;
                break;
              }
            }

            ['quiz', 'checkins', 'qna', 'games', 'surveys', 'config'].forEach(function (sec) {
              if (d[sec]) latestRemoteMeta[sec] = d[sec];
              if (!doesPageUseSection(sec, curPid)) return;
              if (sec === 'config') {
                if (streamHasChangedCfg || (d.config && d.config !== lastSeenMeta.config) || !hasLocalSectionCache('config')) {
                  if (d.config) lastSeenMeta.config = d.config;
                  syncConfigFromMeta(d, false);
                }
                return;
              }
              var seenKey = getSectionSeenKey(sec, curPid);
              var rTs = Number(d[sec]) || -1;
              if (rTs !== lastSeenMeta[seenKey] || !hasLocalSectionCache(sec)) {
                requestSectionSync(sec, rTs, false);
              }
            });
            if (metaChanged) saveLastSeenMeta();
          }
        } else {
          var segs = p.replace(/^\//, '').split('/');
          var cleanSec = segs[0];
          if (cleanSec === 'config_key') {
            return;
          } else if (cleanSec === 'config_keys') {
            // /config_keys/{key} 단건 변경 또는 /config_keys 전체 갱신
            var cfgPatch = {};
            if (segs[1]) cfgPatch[segs[1]] = d;
            else if (d && typeof d === 'object') cfgPatch = d;
            syncConfigFromMeta({ config_keys: cfgPatch }, false);
          } else if (cleanSec === 'session_reset_at') {
            if (d && d !== lastSeenMeta.session_reset_at) {
              lastSeenMeta.session_reset_at = d;
              saveLastSeenMeta();
              checkSessionResetSignal(d);
            }
          } else if (cleanSec === 'quiz_reset_at') {
            if (d && d !== lastSeenMeta.quiz_reset_at) {
              checkQuizResetSignal(d);
            }
          } else if (cleanSec === 'config') {
            // config 타임스탬프 단독 변경은 config_keys 이벤트에서 처리 (중복 다운로드 방지)
            if (d) { lastSeenMeta.config = d; latestRemoteMeta.config = d; }
          } else if (cleanSec) {
            var patchTs = Number(d) || Date.now();
            latestRemoteMeta[cleanSec] = patchTs;
            if (!doesPageUseSection(cleanSec, curPid)) return;
            var patchSeenKey = getSectionSeenKey(cleanSec, curPid);
            if (patchTs !== lastSeenMeta[patchSeenKey]) {
              requestSectionSync(cleanSec, patchTs, false);
            }
          }
        }
      }

      cloudEventSource.addEventListener('put', function (e) {
        if (!e || !e.data) return;
        try { handleStreamPayload(JSON.parse(e.data)); } catch (err) {}
      });

      cloudEventSource.addEventListener('patch', function (e) {
        if (!e || !e.data) return;
        try { handleStreamPayload(JSON.parse(e.data)); } catch (err) {}
      });

      cloudEventSource.onopen = function () {
        streamConnected = true;
        window.dispatchEvent(new CustomEvent('hvac:stream-status', { detail: { connected: true, mode: 'stream' } }));
      };

      cloudEventSource.onerror = function () {
        streamConnected = false;
        window.dispatchEvent(new CustomEvent('hvac:stream-status', { detail: { connected: false, mode: 'polling' } }));
      };
    } catch (err) {
      console.warn('initCloudStream error:', err);
    }
  }

  // 클라우드 -> 로컬 변경사항 폴링 (meta 타임스탬프 비교 후 변경된 섹션만 다운로드)
  function pollCloudChanges(forceAll) {
    var c = getCloudConfig();
    if (!c || !window.fetch || (isSyncingCloud && !forceAll) || document.hidden) return Promise.resolve(false);
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

        ['quiz', 'checkins', 'qna', 'games', 'surveys', 'config'].forEach(function (sec) {
          if (meta[sec]) latestRemoteMeta[sec] = meta[sec];
        });

        if (meta.session_reset_at && meta.session_reset_at !== lastSeenMeta.session_reset_at) {
          lastSeenMeta.session_reset_at = meta.session_reset_at;
          saveLastSeenMeta();
          checkSessionResetSignal(meta.session_reset_at);
        }
        if (meta.quiz_reset_at && meta.quiz_reset_at !== lastSeenMeta.quiz_reset_at) {
          checkQuizResetSignal(meta.quiz_reset_at);
        }

        // 1) 설정(config) 변경 감지 (설정 키별 타임스탬프 비교 → 실제로 변경된 키가 있을 때만 동기화)
        var cfgKeysMap = extractCfgKeysMap(meta);
        var hasChangedCfgKey = false;
        var mapKeys = Object.keys(cfgKeysMap);
        for (var i = 0; i < mapKeys.length; i++) {
          var k = mapKeys[i];
          var ts = Number(cfgKeysMap[k]) || 0;
          if (ts > 0 && ts !== getCfgKeySeenTs(k) && isConfigKeyNeededOnPage(k, pId)) {
            hasChangedCfgKey = true;
            break;
          }
        }

        if (forceAll || !hasLocalSectionCache('config') || hasChangedCfgKey || (meta.config && meta.config !== lastSeenMeta.config)) {
          lastSeenMeta.config = meta.config || Date.now();
          tasks.push(syncConfigFromMeta(meta, !!forceAll));
        }

        // 2) 페이지별 필요 섹션(checkins, qna, quiz, surveys, games) 차등 동기화
        ['checkins', 'qna', 'quiz', 'surveys', 'games'].forEach(function (sec) {
          if (!doesPageUseSection(sec, pId)) return;
          var seenKey = getSectionSeenKey(sec, pId);
          var rTs = Number(meta[sec]) || -1;
          if (forceAll || !hasLocalSectionCache(sec) || rTs !== lastSeenMeta[seenKey]) {
            tasks.push(requestSectionSync(sec, rTs, !!forceAll));
          }
        });

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

  // localStorage.setItem 후킹: 기존 페이지 코드가 localStorage에 쓸 때 클라우드로 자동 전파 (동일값 재저장 및 클라우드 수신 중 에코백 완전 차단)
  Storage.prototype.setItem = function (key, value) {
    var prevRaw = null;
    if (this === window.localStorage) {
      try { prevRaw = window.localStorage.getItem(key); } catch (e) {}
    }
    origSetItem.call(this, key, value);
    // 주의: isSyncingCloud(폴링 네트워크 대기 중)일 때 사용자가 버튼을 눌러 setItem한 변경이 무시되지 않도록 getCloudSyncLockCount() > 0 만 체크!
    if (this !== window.localStorage || getCloudSyncLockCount() > 0) return;
    var isLuckyKey = (key === 'hvac_luckydraw_state' || key === 'hvac_luckydraw_config');
    if (prevRaw === value && !isLuckyKey) return; // 기존 로컬 값과 100% 동일하면 클라우드 PUT / meta 갱신 발생 안 함 (단, 럭키드로우는 강제 동기화 허용)
    var c = getCloudConfig();
    if (!c) return;
    try {
      var curPid = pageId();
      if (CONFIG_KEYS.indexOf(key) >= 0 && (curPid === 'admin' || (curPid === 'luckydraw-stage' && isLuckyKey))) {
        pushConfigToCloud(key, JSON.parse(value));
      } else if (key === 'hvac_qna_list') {
        pushQnaListToCloud(JSON.parse(value));
      } else if (key === 'hvac_checkin_list' && curPid === 'admin') {
        pushCheckinListToCloud(JSON.parse(value), read('hvac_blocked_users'));
      } else if (key === 'hvac_blocked_users' && curPid === 'admin') {
        pushCheckinListToCloud(read('hvac_checkin_list'), JSON.parse(value));
      }
    } catch (e) {}
  };

  // 주기적 스마트 폴링 및 SSE 소켓 스트림 가동
  var pollTimer = null;
  function startCloudLoop() {
    if (window.__hvacPollTimer) {
      clearInterval(window.__hvacPollTimer);
      window.__hvacPollTimer = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (!getCloudConfig()) return;
    var pId = pageId();
    // index.html 랜딩 페이지는 정적 스케줄/안내 페이지(site-config.json 연동)이므로 실시간 Firebase 소켓/폴링 제외 (트래픽 0B)
    if (pId === 'index') return;

    if (pId === 'checkin' && read('hvac_checkin_passcode') === null) {
      syncSingleConfigKey('hvac_checkin_passcode');
    }

    // 관리자 콘솔(admin) 및 사회자 무대(luckydraw-stage)는 페이지 진입 즉시 클라우드의 최신 럭키드로우 상태/설정을 강제 검증
    if (pId === 'admin' || pId === 'luckydraw-stage') {
      syncSingleConfigKey('hvac_luckydraw_config');
      syncSingleConfigKey('hvac_luckydraw_state');
    }

    // 1. 200명 전원 실시간 SSE 소켓 스트림 연결 (초기 put 이벤트로 변경된 섹션만 차등 동기화)
    initCloudStream();

    // 2. 페이지 진입/새로고침 즉시 초기 차등 동기화 1회 실행 (inFlightSectionPromises로 SSE와 중복 요청 0건 보장!)
    pollCloudChanges(false);

    // 3. 주기적 안전 백업 폴링
    // - 일반 참석자 페이지: SSE 정상 연결 중에는 폴링 생략 (트래픽 0B)
    // - 관리자(admin), 사회자 럭키드로우(luckydraw-stage), 실시간 Q&A/사회자 세션별 Q&A(qna), 출석현황/퀴즈당첨자: 4초 주기로 초경량 meta 폴링 병행 (SSE 사일런트 드롭 완벽 방어)
    var isCriticalStagePage = (pId === 'admin' || pId === 'luckydraw-stage' || pId === 'qna' || pId === 'attendance-dashboard' || pId === 'quiz-winners');
    var fastPages = ['admin', 'qna', 'attendance-dashboard', 'quiz-winners', 'game-leaderboard', 'lunch-screen', 'luckydraw-stage'];
    var intervalMs = isCriticalStagePage ? 4000 : (fastPages.indexOf(pId) >= 0 ? 15000 : 30000);
    pollTimer = setInterval(function () {
      if (!isCriticalStagePage && streamConnected && cloudEventSource && cloudEventSource.readyState === 1) return;
      pollCloudChanges(false);
    }, intervalMs);
    window.__hvacPollTimer = pollTimer;
  }

  // 모바일 화면 꺼짐 복귀 / 백그라운드 탭 전환 시 스트림 및 데이터 재연결
  var lastResumeCheckAt = 0;
  function checkAndResumeStream() {
    checkRemoteAppVersion();
    var pId = pageId();
    if (pId === 'index') return;
    var now = Date.now();
    if (now - lastResumeCheckAt < 2000) return;
    lastResumeCheckAt = now;
    if (!getCloudConfig()) return;
    // 주요 실시간 화면은 탭 포커스 복귀 시 즉시 최신 meta 확인
    if (pId === 'admin' || pId === 'luckydraw-stage' || pId === 'qna' || pId === 'attendance-dashboard' || pId === 'quiz-winners') {
      pollCloudChanges(false);
      if (pId === 'admin' || pId === 'luckydraw-stage') {
        syncSingleConfigKey('hvac_luckydraw_state');
      }
      if (!cloudEventSource || cloudEventSource.readyState === 2) {
        initCloudStream();
      }
      return;
    }
    if (streamConnected && cloudEventSource && cloudEventSource.readyState === 1) {
      return;
    }
    pollCloudChanges(false);
    if (!cloudEventSource || cloudEventSource.readyState === 2 /* EventSource.CLOSED */) {
      initCloudStream();
    }
  }

  // BFCache (Back-Forward Cache) 복원 감지 시 페이지 새로고침
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) {
      window.location.reload();
    }
  });

  var lastVersionCheckAt = 0;
  var versionCheckInFlight = false;

  function parseBuildVerNum(v) {
    var digits = String(v || '').replace(/\D/g, '');
    return digits ? Number(digits) : 0;
  }

  function isNewerRemoteVersion(remoteVer, localVer) {
    var rNum = parseBuildVerNum(remoteVer);
    var lNum = parseBuildVerNum(localVer);
    if (rNum > 0 && lNum > 0) return rNum > lNum;
    return !!(remoteVer && localVer && String(remoteVer).trim() !== String(localVer).trim());
  }

  function checkRemoteAppVersion() {
    if (location.protocol === 'file:' || !window.fetch) return;
    if (versionCheckInFlight) return;
    var now = Date.now();
    if (now - lastVersionCheckAt < 15000) return;
    lastVersionCheckAt = now;
    versionCheckInFlight = true;

    fetch(BASE + 'version.json?v=' + now, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (info) {
        if (!info || !info.version) return;
        var curVer = getCurrentAppVersion();
        if (isNewerRemoteVersion(info.version, curVer)) {
          showVersionUpdateToast(info.version);
        } else {
          // 이미 최신 버전이 반영되었으면 기존 배너/재시도 플래그 정리
          try {
            if (window.sessionStorage) {
              window.sessionStorage.removeItem('hvac_update_reloaded_ver');
              window.sessionStorage.removeItem('hvac_update_reloaded_ts');
            }
          } catch (e) {}
          var staleBanner = document.getElementById('hvac-version-update-banner');
          if (staleBanner && staleBanner.parentNode) staleBanner.parentNode.removeChild(staleBanner);
        }
      })
      .catch(function () {})
      .finally(function () {
        versionCheckInFlight = false;
      });
  }

  function buildCacheBustedUrl(targetVer) {
    try {
      var u = new URL(window.location.href);
      u.searchParams.set('_hv', String(targetVer || Date.now()));
      return u.toString();
    } catch (e) {
      var baseHref = window.location.href.split('#')[0];
      var hashPart = window.location.hash || '';
      var sep = baseHref.indexOf('?') >= 0 ? '&' : '?';
      return baseHref + sep + '_hv=' + encodeURIComponent(String(targetVer || Date.now())) + hashPart;
    }
  }

  function showVersionUpdateToast(newVer) {
    var verStr = String(newVer || '').trim();
    if (!verStr) return;

    var curVer = getCurrentAppVersion();
    if (!isNewerRemoteVersion(verStr, curVer)) return;

    // 1. 이미 사용자가 같은 버전에 대해 닫았거나 이미 새로고침을 진행한 경우 중복 표시 영구 차단
    try {
      var disVer = (window.sessionStorage && window.sessionStorage.getItem('hvac_update_dismissed_ver')) ||
                   (window.localStorage && window.localStorage.getItem('hvac_update_dismissed_ver'));
      if (disVer && !isNewerRemoteVersion(verStr, disVer)) return;

      var relVer = (window.sessionStorage && window.sessionStorage.getItem('hvac_update_reloaded_ver')) ||
                   (window.localStorage && window.localStorage.getItem('hvac_update_reloaded_ver'));
      if (relVer && !isNewerRemoteVersion(verStr, relVer)) return;
    } catch (e) {}

    // 2. DOM ready 보장 & 중복 배너 원천 차단 (싱글턴)
    if (!document.body) {
      if (!window.__hvacPendingUpdateVer) {
        window.__hvacPendingUpdateVer = verStr;
        document.addEventListener('DOMContentLoaded', function () {
          var v = window.__hvacPendingUpdateVer;
          window.__hvacPendingUpdateVer = null;
          if (v) showVersionUpdateToast(v);
        }, { once: true });
      }
      return;
    }

    if (document.getElementById('hvac-version-update-banner') || window.__hvacUpdateToastShownVer === verStr) return;
    window.__hvacUpdateToastShownVer = verStr;

    var existingBanners = document.querySelectorAll('[data-hvac-update-banner="true"]');
    for (var i = 0; i < existingBanners.length; i++) {
      if (existingBanners[i] && existingBanners[i].parentNode) {
        existingBanners[i].parentNode.removeChild(existingBanners[i]);
      }
    }

    var banner = document.createElement('div');
    banner.id = 'hvac-version-update-banner';
    banner.setAttribute('data-hvac-update-banner', 'true');
    banner.setAttribute('data-target-ver', verStr);
    banner.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;background:linear-gradient(135deg,#059669,#10b981);color:#ffffff;padding:10px 14px 10px 20px;border-radius:99px;font-family:Pretendard,-apple-system,sans-serif;font-size:13.5px;font-weight:750;box-shadow:0 8px 30px rgba(0,0,0,0.5),0 0 20px rgba(16,185,129,0.4);display:flex;align-items:center;gap:10px;cursor:pointer;max-width:92vw;white-space:nowrap;';

    var msgSpan = document.createElement('span');
    msgSpan.textContent = '✨ 웹사이트 최신 업데이트가 적용되었습니다.';

    var reloadBtn = document.createElement('span');
    reloadBtn.style.cssText = 'background:rgba(0,0,0,0.25);padding:4px 10px;border-radius:20px;font-size:12px;font-weight:800;';
    reloadBtn.textContent = '새로고침 ↻';

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', '업데이트 알림 닫기');
    closeBtn.style.cssText = 'background:rgba(255,255,255,0.18);border:none;color:#ffffff;width:24px;height:24px;border-radius:50%;font-size:12px;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;line-height:1;';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      try {
        if (window.sessionStorage) window.sessionStorage.setItem('hvac_update_dismissed_ver', verStr);
        if (window.localStorage) {
          window.localStorage.setItem('hvac_update_dismissed_ver', verStr);
          window.localStorage.setItem('hvac_update_dismissed_ts', String(Date.now()));
        }
      } catch (e) {}
      if (banner.parentNode) banner.parentNode.removeChild(banner);
    });

    banner.appendChild(msgSpan);
    banner.appendChild(reloadBtn);
    banner.appendChild(closeBtn);

    banner.addEventListener('click', function () {
      try {
        if (window.sessionStorage) {
          window.sessionStorage.setItem('hvac_update_reloaded_ver', verStr);
          window.sessionStorage.setItem('hvac_update_reloaded_ts', String(Date.now()));
        }
        if (window.localStorage) {
          window.localStorage.setItem('hvac_update_reloaded_ver', verStr);
          window.localStorage.setItem('hvac_app_build_version', verStr);
        }
      } catch (e) {}
      var nextUrl = buildCacheBustedUrl(verStr);
      try {
        fetch(window.location.href.split('#')[0], { cache: 'reload' })
          .catch(function () {})
          .finally(function () { window.location.replace(nextUrl); });
      } catch (e) {
        window.location.replace(nextUrl);
      }
    });
    document.body.appendChild(banner);
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      checkAndResumeStream();
    }
  });

  window.addEventListener('focus', function () {
    checkAndResumeStream();
  });

  window.addEventListener('online', function () {
    checkAndResumeStream();
  });

  // ---------------------------------------------------------
  // 부트스트랩
  // ---------------------------------------------------------
  applyTheme();

  var onReadyExecuted = false;
  function onReady() {
    if (onReadyExecuted) return;
    onReadyExecuted = true;
    applyLinks();
    renderBanner();
    syncPublished().then(function () {
      startCloudLoop();
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
    window.addEventListener('load', onReady);
    // document.open()/write()/close() 마운트 환경에서 DOMContentLoaded 미발생 방어 폴백
    setTimeout(onReady, 80);
  } else {
    onReady();
  }

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

    // 글로벌 세션 만료 및 강제 체크아웃 이벤트 핸들러
    window.addEventListener('hvac:session-terminated', function (ev) {
      writeLocalSilent('hvac_user_checked', null);
      try { localStorage.removeItem('hvac_user_checked'); } catch (e) {}
      try { localStorage.removeItem('hvac_checkin_user'); } catch (e) {}
      var pid = pageId();
      if (pid !== 'index' && pid !== 'checkin' && pid !== 'admin' && pid !== 'attendance-dashboard' && pid !== 'luckydraw-stage' && pid !== 'quiz-winners') {
        alert('⚠️ 안내: 관리자 권한에 의해 출석 세션이 초기화되었습니다.\n세미나 안내 화면으로 이동합니다.');
        setTimeout(function () {
          window.location.href = './index.html';
        }, 1200);
      }
    });
  }

  window.HVAC = {
    alert: showCustomAlert,
    buildPublishedConfig: buildPublishedConfig,
    CONFIG_KEYS: CONFIG_KEYS,
    read: read,
    writeLocalSilent: writeLocalSilent,
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
    DEFAULT_ROSTER: DEFAULT_ROSTER,
    getRosterList: getRosterList,
    findRosterEntry: findRosterEntry,
    isLuckyDrawEligibleAttendee: isLuckyDrawEligibleAttendee,
    formatQnaAuthor: formatQnaAuthor,
    getLikedQnaMap: getLikedQnaMap,
    setQnaLikedState: setQnaLikedState,
    isQnaLiked: isQnaLiked,
    normalizeQnaItemForLocal: normalizeQnaItemForLocal,
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
      syncSection: syncSpecificSection,
      syncAdminTab: function (tabId) {
        var secMap = {
          tabQna: 'qna',
          tabMc: 'qna',
          tabCheckin: 'checkins',
          tabDraw: 'checkins',
          tabQuiz: 'quiz',
          tabSurvey: 'surveys',
          tabGames: 'games'
        };
        var sec = secMap[tabId];
        if (!sec) return Promise.resolve(false);
        var cacheKeyMap = {
          qna: 'hvac_qna_list',
          checkins: 'hvac_checkin_list',
          quiz: 'hvac_quiz_submissions',
          surveys: 'hvac_survey_responses',
          games: 'hvac_game_submissions'
        };
        var seenKey = getSectionSeenKey(sec, 'admin');
        var hasCache = read(cacheKeyMap[sec]) !== null;
        var rTs = Number(latestRemoteMeta[sec]) || 0;
        var needSync = !hasCache || !lastSeenMeta[seenKey] || (rTs && rTs !== lastSeenMeta[seenKey]);
        if (!needSync) return Promise.resolve(false);
        return requestSectionSync(sec, rTs || Date.now(), true);
      },
      isActive: function () { var c = getCloudConfig(); return !!(c && c.enabled && c.dbUrl); },
      isStreamConnected: function () { return !!streamConnected; },
      saveConfig: function (cfg) { writeLocalSilent(CLOUD_CFG_KEY, cfg); startCloudLoop(); },
      cloudPath: cloudPath,
      lookupRosterEntry: function (email, name) {
        if (!email && !name) return Promise.resolve(null);
        var found = findRosterEntry(email, name);
        if (found) return Promise.resolve(found);
        var cleanEmail = String(email || '').toLowerCase().replace('@lge.com', '').trim();
        var cleanKey = cleanEmail.replace(/[.#$\[\]\/]/g, '_');
        if (!window.fetch || !getCloudConfig() || !cleanKey) return Promise.resolve(null);
        return fetch(cloudPath('roster_map/' + cleanKey), { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (entry) {
            if (entry && entry.name) return entry;
            return null;
          })
          .catch(function () { return null; });
      },
      pushCheckinList: pushCheckinListToCloud,
      pushQnaList: pushQnaListToCloud,
      addQnaQuestion: addQnaQuestionToCloud,
      toggleQnaLike: toggleQnaLikeInCloud,
      checkin: cloudCheckin,
      verifyAndClaimGift: cloudVerifyAndClaimGift,
      getGiftStatus: cloudGetGiftStatus,
      pushQuizScore: pushQuizScoreToCloud,
      pushSurvey: pushSurveyResponseToCloud,
      pushGameRecord: pushGameRecordToCloud,
      fetchGames: fetchGameSubmissionsFromCloud,
      fetchGameTop3: fetchGameTop3FromCloud,
      resetGames: resetGameSubmissionsOnCloud,
      saveLuckyDraw: function (state) { return pushConfigToCloud('hvac_luckydraw_state', state); },
      restart: startCloudLoop
    },
    onConfigUpdated: function (fn) {
      window.addEventListener('hvac:config-updated', function (e) {
        try { fn((e.detail && e.detail.keys) || CONFIG_KEYS); } catch (err) { console.warn(err); }
      });
    }
  };
})();
