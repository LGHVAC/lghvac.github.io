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

  var origSetItem = typeof Storage !== 'undefined' ? Storage.prototype.setItem : null;
  var cloudSyncLockCount = 0;

  function withCloudSyncLock(fn) {
    cloudSyncLockCount++;
    try {
      return fn();
    } finally {
      cloudSyncLockCount = Math.max(0, cloudSyncLockCount - 1);
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

  function applyPublishedConfig(cfg) {
    if (!cfg || !cfg.publishedAt || !cfg.data || typeof cfg.data !== 'object') return false;
    if (cfg.metaConfigTs && (!lastSeenMeta.config || lastSeenMeta.config < cfg.metaConfigTs)) {
      lastSeenMeta.config = cfg.metaConfigTs;
      saveLastSeenMeta();
    }
    // site-config.json에 포함된 설정 키는 metaConfigTs 시점까지 최신으로 간주 (불필요한 재다운로드 방지)
    if (cfg.metaConfigTs) {
      var seenChanged = false;
      Object.keys(cfg.data).forEach(function (k) {
        if (CONFIG_KEYS.indexOf(k) < 0) return;
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
    return fetch(BASE + 'site-config.json')
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

  var LAST_META_KEY = 'hvac_last_seen_meta';
  var savedMeta = read(LAST_META_KEY);
  var lastSeenMeta = (savedMeta && typeof savedMeta === 'object')
    ? Object.assign({ config: 0, checkins: 0, qna: 0, quiz: 0, surveys: 0, games: 0, session_reset_at: 0 }, savedMeta)
    : { config: 0, checkins: 0, qna: 0, quiz: 0, surveys: 0, games: 0, session_reset_at: 0 };
  var latestRemoteMeta = Object.assign({}, lastSeenMeta);
  var isSyncingCloud = false;

  // 설정 키별 최종 수정 시각 (meta/config_keys/{key}) 추적
  // - 기존에는 meta.config_key(마지막 변경 키 1개)만 보고 동기화하여,
  //   접속이 끊겨 있던 사이 일정표 → 럭키드로우 순으로 변경되면 일정표 변경을 영영 놓치는 문제가 있었음
  var CFG_KEYS_SEEN = 'hvac_last_seen_cfgkeys';
  var savedCfgSeen = read(CFG_KEYS_SEEN);
  var lastSeenCfgKeys = (savedCfgSeen && typeof savedCfgSeen === 'object') ? savedCfgSeen : {};

  function saveSeenCfgKeys() {
    writeLocalSilent(CFG_KEYS_SEEN, lastSeenCfgKeys);
  }

  function saveLastSeenMeta() {
    writeLocalSilent(LAST_META_KEY, lastSeenMeta);
  }

  function isAdminSectionNeeded(sec) {
    var tab = (typeof window !== 'undefined' && window._hvacAdminActiveTab) || 'tabQna';
    if (sec === 'config') return true;
    if (sec === 'qna') return tab === 'tabQna' || tab === 'tabMc';
    if (sec === 'checkins') return tab === 'tabCheckin' || tab === 'tabDraw';
    if (sec === 'quiz') return tab === 'tabQuiz';
    if (sec === 'surveys') return tab === 'tabSurvey';
    if (sec === 'games') return tab === 'tabGames';
    return true;
  }

  function hasLocalSectionCache(sec) {
    var pId = pageId();
    if (sec === 'config') {
      if (pId === 'admin') return read('hvac_schedule_settings') !== null && read('hvac_luckydraw_config') !== null && lastSeenMeta.config > 0;
      if (pId === 'luckydraw-stage') return read('hvac_luckydraw_config') !== null && lastSeenMeta.config > 0;
      return read('hvac_schedule_settings') !== null;
    }
    if (sec === 'checkins') {
      if (pId === 'admin') return !isAdminSectionNeeded('checkins') || read('hvac_checkin_list') !== null;
      var fullCheckinPages = ['attendance-dashboard', 'luckydraw-stage', 'quiz-winners'];
      if (fullCheckinPages.indexOf(pId) >= 0) return read('hvac_checkin_list') !== null;
      return true;
    }
    if (sec === 'qna') {
      if (pId === 'admin') return !isAdminSectionNeeded('qna') || read('hvac_qna_list') !== null;
      if (pId === 'qna') return read('hvac_qna_list') !== null;
      return true;
    }
    if (sec === 'quiz') {
      if (pId === 'quiz-winners') return read('hvac_quiz_submissions') !== null;
      if (pId === 'admin' && isAdminSectionNeeded('quiz')) return read('hvac_quiz_submissions') !== null;
      return true;
    }
    if (sec === 'games') {
      if (pId === 'lunch-screen' || pId === 'game-leaderboard') return read('hvac_game_top3') !== null;
      if (pId === 'admin' && isAdminSectionNeeded('games')) return read('hvac_game_submissions') !== null;
      return true;
    }
    if (sec === 'surveys') {
      if (pId === 'admin' && isAdminSectionNeeded('surveys')) return read('hvac_survey_responses') !== null;
      return true;
    }
    return true;
  }

  var lastPushedConfigMap = {};
  var lastPushedSectionMap = {};

  function touchCloudMeta(section, subKey) {
    if (!window.fetch) return Promise.resolve();
    var ts = Date.now();
    if (section === 'config') {
      var metaUrl = cloudPath('meta');
      if (!metaUrl) return Promise.resolve();
      var cfgKeyName = subKey || 'all';
      lastSeenMeta.config = ts;
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
    saveLastSeenMeta();
    return fetch(u, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ts)
    }).then(function () {
      return true;
    }).catch(function () { return false; });
  }

  // 관리자 -> 클라우드: 설정 데이터 업로드 (동일 키 1.5초 내 중복 PUT 방지 + 핀포인트 config_key 브로드캐스트)
  function pushConfigToCloud(key, val) {
    var u = cloudPath('config/' + key);
    if (!u || !window.fetch) return Promise.resolve(false);
    var bodyStr = JSON.stringify(val);
    var now = Date.now();
    var prev = lastPushedConfigMap[key];
    if (prev && prev.body === bodyStr && (now - prev.ts < 1500)) {
      return Promise.resolve(true);
    }
    lastPushedConfigMap[key] = { body: bodyStr, ts: now };

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
    // 🟢 사전 등록 대역 (1~199)
    { seq: 1, prize: '스타벅스 커피 쿠폰 (사전 1호 체크인)' },
    { seq: 7, prize: '스타벅스 커피 쿠폰 (사전 럭키 7)' },
    { seq: 10, prize: '스타벅스 커피 쿠폰 (사전 10번째 체크인)' },
    { seq: 77, prize: '스타벅스 커피 쿠폰 (행운의 77번째)' },
    { seq: 100, prize: '스타벅스 커피 쿠폰 (센추리 100번째)' },
    // 🟡 현장 추가 등록 대역 (201~299)
    { seq: 201, prize: '스타벅스 커피 쿠폰 (현장 1호 등록)' },
    { seq: 207, prize: '스타벅스 커피 쿠폰 (현장 럭키 7)' },
    { seq: 210, prize: '스타벅스 커피 쿠폰 (현장 10번째 등록)' },
    // 👑 VIP 초대 대역 (701~799)
    { seq: 701, prize: '스타벅스 커피 쿠폰 (VIP 1호 체크인)' },
    { seq: 707, prize: '스타벅스 커피 쿠폰 (VIP 럭키 7)' },
    // 🏢 하이엠 대역 (901~999)
    { seq: 901, prize: '스타벅스 커피 쿠폰 (하이엠 1호 체크인)' },
    { seq: 907, prize: '스타벅스 커피 쿠폰 (하이엠 럭키 7)' }
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

    // 카테고리 결정: 운영진(300번대) / 외부(500번대) / VIP(700번대) / 하이엠(900번대) / 현장추가(200번대) / 사전등록(1번대)
    var cat = attendee.category;
    if (!cat) {
      if (isOp || attendee.type === 'operator') cat = 'operator';
      else if (String(attendee.dept || '').includes('하이엠') || String(attendee.position || '').includes('하이엠')) cat = 'him';
      else if (String(attendee.dept || '').includes('사외') || String(attendee.position || '').includes('강사') || String(attendee.position || '').includes('교수') || String(attendee.dept || '').includes('외부')) cat = 'external';
      else if (String(attendee.dept || '').includes('VIP') || String(attendee.position || '').includes('초대')) cat = 'vip';
      else if (attendee.type === 'pre' || attendee.type === 'matched' || attendee.type === 'pre_registered') cat = 'pre';
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
          var updated = Object.assign({}, existing, attendee, {
            seq: existing.seq,
            checkinId: existing.checkinId || ('HVAC-' + String(existing.seq).padStart(3, '0')),
            category: existing.category || cat,
            isOperator: isOp,
            type: isOp ? 'operator' : (existing.type || 'walkin'),
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

              var checkinType = isOp ? 'operator' : (rosterMatch ? (rosterMatch.type || 'pre_registered') : (attendee.type || 'walkin'));
              var position = attendee.position || (rosterMatch ? (rosterMatch.position || rosterMatch.title || '') : '');
              var dept = attendee.dept || (rosterMatch ? (rosterMatch.dept || '') : '');
              var empNo = attendee.empNo || (rosterMatch ? (rosterMatch.empNo || '') : '');
              var resolvedCat = attendee.category || (rosterMatch ? (rosterMatch.category || rosterMatch.regMethod) : cat);
              var resolvedReg = attendee.regMethod || (rosterMatch ? (rosterMatch.regMethod || 'pre') : 'walkin');

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

  // 출석 목록 전체 클라우드 동기화 (관리자 수정/초기화 시, 1.5초 중복 PUT 방지)
  function pushCheckinListToCloud(list, blocked) {
    var c = getCloudConfig();
    if (!c || !window.fetch) return Promise.resolve(false);
    var itemsMap = {};
    var maxPre = 0;
    var maxWalkin = 200;
    var maxOp = 300;
    var maxExt = 500;
    var maxVip = 700;
    var maxHim = 900;
    (list || []).forEach(function (item) {
      var k = String(item.email || ('u_' + item.seq)).toLowerCase().replace('@lge.com', '').replace(/[.#$\[\]\/]/g, '_');
      itemsMap[k] = item;
      var s = Number(item.seq) || 0;
      if (s >= 900 && s < 1000 && s > maxHim) maxHim = s;
      else if (s >= 700 && s < 900 && s > maxVip) maxVip = s;
      else if (s >= 500 && s < 700 && s > maxExt) maxExt = s;
      else if (s >= 300 && s < 500 && s > maxOp) maxOp = s;
      else if (s >= 200 && s < 300 && s > maxWalkin) maxWalkin = s;
      else if (s > 0 && s < 200 && s > maxPre) maxPre = s;
    });
    var body = {
      items: itemsMap,
      seqCounter: maxPre,
      seqCounter_walkin: maxWalkin,
      seqCounter_operator: maxOp,
      seqCounter_external: maxExt,
      seqCounter_vip: maxVip,
      seqCounter_him: maxHim
    };
    if (Array.isArray(blocked)) body.blocked = blocked;
    var bodyStr = JSON.stringify(body);
    var now = Date.now();
    var prev = lastPushedSectionMap['checkins'];
    if (prev && prev.body === bodyStr && (now - prev.ts < 2000)) {
      return Promise.resolve(true);
    }
    lastPushedSectionMap['checkins'] = { body: bodyStr, ts: now };

    return fetch(cloudPath('checkins'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: bodyStr
    }).then(function (r) {
      if (r.ok) return touchCloudMeta('checkins').then(function () { return true; });
      return false;
    }).catch(function () { return false; });
  }

  // Q&A 질문 목록 클라우드 동기화 (1.5초 중복 PUT 방지)
  function pushQnaListToCloud(qList) {
    var c = getCloudConfig();
    if (!c || !window.fetch) return Promise.resolve(false);
    var bodyStr = JSON.stringify(qList || []);
    var now = Date.now();
    var prev = lastPushedSectionMap['qna'];
    if (prev && prev.body === bodyStr && (now - prev.ts < 2000)) {
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
      .catch(function () { return { success: false }; });
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
      if (pId === 'quiz-winners' || (pId === 'admin' && (forceAdminSync || isAdminSectionNeeded('quiz')))) {
        return fetch(cloudPath('quiz/submissions'), { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (subMap) {
            var list = [];
            if (subMap && typeof subMap === 'object') {
              list = Object.values(subMap).filter(Boolean);
            }
            withCloudSyncLock(function () {
              writeLocalSilent('hvac_quiz_submissions', list);
              window.dispatchEvent(new CustomEvent('hvac:quiz-submissions-updated', { detail: { submissions: list } }));
              window.dispatchEvent(new StorageEvent('storage', { key: 'hvac_quiz_submissions' }));
            });
            return true;
          }).catch(function () { return false; });
      }
    } else if (secName === 'checkins') {
      var fullCheckinPages = ['admin', 'attendance-dashboard', 'luckydraw-stage', 'quiz-winners'];
      if (fullCheckinPages.indexOf(pId) >= 0) {
        if (pId === 'admin' && !forceAdminSync && !isAdminSectionNeeded('checkins')) {
          return Promise.resolve(false);
        }
        return fetch(cloudPath('checkins'), { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (chkData) {
            var arr = [];
            if (chkData && typeof chkData === 'object' && chkData.items && typeof chkData.items === 'object') {
              arr = Object.values(chkData.items).filter(Boolean);
              arr.sort(function (a, b) { return (b.seq || 0) - (a.seq || 0); });
            }
            withCloudSyncLock(function () {
              writeLocalSilent('hvac_checkin_list', arr);
              if (chkData && Array.isArray(chkData.blocked)) {
                writeLocalSilent('hvac_blocked_users', chkData.blocked);
              }
              window.dispatchEvent(new CustomEvent('hvac:checkin-updated', { detail: { list: arr } }));
              window.dispatchEvent(new StorageEvent('storage', { key: 'hvac_checkin_list' }));
            });
            return true;
          }).catch(function () { return false; });
      } else {
        // 일반 참석자는 본인 계정 상태(~200B)만 핀포인트 확인하여 개인정보 보호 및 99.7% 트래픽 절감
        var myUser = read('hvac_user_checked');
        if (myUser && myUser.email) {
          var myClean = String(myUser.email).toLowerCase().replace('@lge.com', '').replace(/[.#$\[\]\/]/g, '_');
          fetch(cloudPath('checkins/items/' + myClean), { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (serverUser) {
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
            }).catch(function () {});
        }
      }
    } else if (secName === 'qna') {
      if (pId === 'qna' || (pId === 'admin' && (forceAdminSync || isAdminSectionNeeded('qna')))) {
        return fetch(cloudPath('qna/list'), { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (remoteQna) {
            if (!Array.isArray(remoteQna)) return false;
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
            withCloudSyncLock(function () {
              writeLocalSilent('hvac_qna_list', remoteQna);
              window.dispatchEvent(new CustomEvent('hvac:qna-updated', { detail: { list: remoteQna } }));
              window.dispatchEvent(new StorageEvent('storage', { key: 'hvac_qna_list' }));
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
      } else if (pId === 'admin' && (forceAdminSync || isAdminSectionNeeded('games'))) {
        return fetch(cloudPath('games/submissions'), { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (subMap) {
            if (!subMap || typeof subMap !== 'object') return false;
            var list = Object.values(subMap).filter(Boolean);
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
      if (pId === 'admin' && (forceAdminSync || isAdminSectionNeeded('surveys'))) {
        return fetch(cloudPath('surveys'), { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (survMap) {
            if (!survMap || typeof survMap !== 'object') return false;
            var list = Object.values(survMap).filter(Boolean);
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
        if (val === undefined || val === null) return false;
        withCloudSyncLock(function () {
          writeLocalSilent(key, val);
          refreshCommon();
          notifyUpdated([key]);
          try { window.dispatchEvent(new StorageEvent('storage', { key: key })); } catch (e) {}
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
      var dynamicKeys = ['hvac_quiz_unlocked_sessions', 'hvac_notice_banner', 'hvac_game_config', 'hvac_checkin_passcode', 'hvac_luckydraw_config', 'hvac_luckydraw_state', 'hvac_milestone_events'];
      var needed = dynamicKeys.filter(function (k) { return isConfigKeyNeededOnPage(k, pId); });
      return Promise.all(needed.map(syncSingleConfigKey)).then(function () { return true; });
    }

    // 3) 관리자 전체 강제 동기화 또는 로컬 캐시가 전혀 없는 경우 전체 config 조회
    return fetch(cloudPath('config'), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfgData) {
        if (!cfgData || typeof cfgData !== 'object') return false;
        withCloudSyncLock(function () {
          var changedKeys = [];
          CONFIG_KEYS.forEach(function (k) {
            if (cfgData[k] !== undefined && cfgData[k] !== null) {
              writeLocalSilent(k, cfgData[k]);
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
        if (ts > (Number(lastSeenCfgKeys[k]) || 0)) lastSeenCfgKeys[k] = ts;
      });
      saveSeenCfgKeys();
      return syncConfigSmart(null, !!forceAll);
    }

    if (mapKeys.length > 0) {
      var allTs = Number(cfgMap.all) || 0;
      if (allTs > (Number(lastSeenCfgKeys.all) || 0)) {
        mapKeys.forEach(function (k) {
          var ts = Number(cfgMap[k]) || 0;
          if (ts > (Number(lastSeenCfgKeys[k]) || 0)) lastSeenCfgKeys[k] = ts;
        });
        saveSeenCfgKeys();
        return syncConfigSmart(null, true);
      }
      var targets = [];
      mapKeys.forEach(function (k) {
        if (k === 'all' || CONFIG_KEYS.indexOf(k) < 0) return;
        var ts = Number(cfgMap[k]) || 0;
        if (ts <= (Number(lastSeenCfgKeys[k]) || 0)) return;
        if (!isConfigKeyNeededOnPage(k, pId)) return; // 다른 페이지용 키는 '미확인'으로 남겨둠
        lastSeenCfgKeys[k] = ts;
        targets.push(k);
      });
      if (targets.length) saveSeenCfgKeys();
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

  function initCloudStream() {
    if (typeof window === 'undefined' || !window.EventSource) return;
    var c = getCloudConfig();
    if (!c || !c.enabled || !c.dbUrl) return;

    if (cloudEventSource) {
      try { cloudEventSource.close(); } catch (e) {}
      cloudEventSource = null;
    }

    var streamUrl = cloudPath('meta');
    try {
      cloudEventSource = new EventSource(streamUrl);

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

      function handleStreamPayload(payload) {
        if (!payload || typeof payload !== 'object') return;
        var p = payload.path || '';
        var d = payload.data;

        if (p === '/' || p === '') {
          if (d && typeof d === 'object') {
            var metaChanged = false;
            if (d.session_reset_at && d.session_reset_at !== lastSeenMeta.session_reset_at) {
              lastSeenMeta.session_reset_at = d.session_reset_at;
              metaChanged = true;
              checkSessionResetSignal(d.session_reset_at);
            }
            var hasCfgKeys = Object.keys(extractCfgKeysMap(d)).length > 0;
            ['quiz', 'checkins', 'qna', 'games', 'surveys', 'config'].forEach(function (sec) {
              if (d[sec]) latestRemoteMeta[sec] = d[sec];
              if (pageId() === 'admin' && !isAdminSectionNeeded(sec)) return;
              if (sec === 'config') {
                // 설정은 키별 타임스탬프(config_keys)를 항상 비교하여 놓친 변경분까지 복구
                if (hasCfgKeys || (d.config && d.config !== lastSeenMeta.config) || !hasLocalSectionCache('config')) {
                  if (d.config) lastSeenMeta.config = d.config;
                  metaChanged = true;
                  syncConfigFromMeta(d, false);
                }
                return;
              }
              if ((d[sec] && d[sec] !== lastSeenMeta[sec]) || !hasLocalSectionCache(sec)) {
                if (d[sec]) lastSeenMeta[sec] = d[sec];
                metaChanged = true;
                syncSpecificSection(sec, false);
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
          } else if (cleanSec === 'config') {
            // config 타임스탬프 단독 변경은 config_keys 이벤트에서 처리 (중복 다운로드 방지)
            if (d) { lastSeenMeta.config = d; latestRemoteMeta.config = d; saveLastSeenMeta(); }
          } else if (cleanSec && d !== lastSeenMeta[cleanSec]) {
            latestRemoteMeta[cleanSec] = d || Date.now();
            if (pageId() === 'admin' && !isAdminSectionNeeded(cleanSec)) return;
            lastSeenMeta[cleanSec] = d || Date.now();
            saveLastSeenMeta();
            syncSpecificSection(cleanSec, false);
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

        ['quiz', 'checkins', 'qna', 'games', 'surveys', 'config'].forEach(function (sec) {
          if (meta[sec]) latestRemoteMeta[sec] = meta[sec];
        });

        // 1) 설정(config) 변경 감지 (설정 키별 타임스탬프 비교 → 변경된 키만 핀포인트 동기화)
        var pollHasCfgKeys = Object.keys(extractCfgKeysMap(meta)).length > 0;
        if (forceAll || !hasLocalSectionCache('config') || pollHasCfgKeys || (meta.config && meta.config !== lastSeenMeta.config)) {
          lastSeenMeta.config = meta.config || Date.now();
          tasks.push(syncConfigFromMeta(meta, !!forceAll));
        }

        // 2) Q&A 변경 감지 (qna, admin 활성 탭에서만 동기화)
        if ((pId === 'qna' || (pId === 'admin' && (forceAll || isAdminSectionNeeded('qna')))) && (forceAll || !hasLocalSectionCache('qna') || (meta.qna && meta.qna !== lastSeenMeta.qna))) {
          lastSeenMeta.qna = meta.qna || Date.now();
          tasks.push(syncSpecificSection('qna', !!forceAll));
        }

        // 3-A) 출석 명부 전체 동기화 (admin 활성 탭, attendance-dashboard, luckydraw-stage, quiz-winners)
        var fullCheckinPages = ['admin', 'attendance-dashboard', 'luckydraw-stage', 'quiz-winners'];
        if (fullCheckinPages.indexOf(pId) >= 0 && (pId !== 'admin' || forceAll || isAdminSectionNeeded('checkins')) && (forceAll || !hasLocalSectionCache('checkins') || (meta.checkins && meta.checkins !== lastSeenMeta.checkins))) {
          lastSeenMeta.checkins = meta.checkins || Date.now();
          tasks.push(syncSpecificSection('checkins', !!forceAll));
        }

        // 3-B) 일반 참석자 초경량 단일 계정 상태 검증
        if (fullCheckinPages.indexOf(pId) < 0 && (forceAll || (meta.checkins && meta.checkins !== lastSeenMeta.checkins) || (meta.session_reset_at && meta.session_reset_at !== lastSeenMeta.session_reset_at))) {
          lastSeenMeta.checkins = meta.checkins || Date.now();
          if (meta.session_reset_at) lastSeenMeta.session_reset_at = meta.session_reset_at;
          var myUser = read('hvac_user_checked');
          if (myUser && myUser.email) {
            var resetEpoch = Number(meta.session_reset_at) || 0;
            var userCheckedEpoch = Math.max(Number(myUser.checkedAt) || 0, Number(myUser.lastActiveAt) || 0, Number(myUser.checkinTimeMs) || 0);
            if (resetEpoch > 0 && userCheckedEpoch < resetEpoch) {
              withCloudSyncLock(function () {
                writeLocalSilent('hvac_user_checked', null);
                try { localStorage.removeItem('hvac_user_checked'); } catch (e) {}
                try { localStorage.removeItem('hvac_checkin_user'); } catch (e) {}
                window.dispatchEvent(new CustomEvent('hvac:session-terminated', {
                  detail: { deviceType: '관리자 전체 세션 강제 체크아웃', terminatedAt: resetEpoch }
                }));
              });
              saveLastSeenMeta();
              isSyncingCloud = false;
              return false;
            }
            tasks.push(syncSpecificSection('checkins', false));
          }
        }

        // 4) 퀴즈 제출 현황 변경 감지 (admin 활성 탭 및 quiz-winners 사회자 화면 동기화)
        if ((pId === 'quiz-winners' || (pId === 'admin' && (forceAll || isAdminSectionNeeded('quiz')))) && (forceAll || !hasLocalSectionCache('quiz') || (meta.quiz && meta.quiz !== lastSeenMeta.quiz))) {
          lastSeenMeta.quiz = meta.quiz || Date.now();
          tasks.push(syncSpecificSection('quiz', !!forceAll));
        }

        // 5) 만족도 설문(survey) 응답 변경 감지 (admin 서베이 탭 활성 시)
        if (pId === 'admin' && (forceAll || isAdminSectionNeeded('surveys')) && (forceAll || !hasLocalSectionCache('surveys') || (meta.surveys && meta.surveys !== lastSeenMeta.surveys))) {
          lastSeenMeta.surveys = meta.surveys || Date.now();
          tasks.push(syncSpecificSection('surveys', !!forceAll));
        }

        // 6) 점심 미니게임 변경 감지 (전광판은 450B Top3만, admin은 미니게임 탭 활성 시에만)
        if ((pId === 'lunch-screen' || pId === 'game-leaderboard' || (pId === 'admin' && (forceAll || isAdminSectionNeeded('games')))) && (forceAll || !hasLocalSectionCache('games') || (meta.games && meta.games !== lastSeenMeta.games))) {
          lastSeenMeta.games = meta.games || Date.now();
          tasks.push(syncSpecificSection('games', !!forceAll));
        }

        saveLastSeenMeta();

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
    if (this !== window.localStorage || isSyncingCloud || cloudSyncLockCount > 0) return;
    if (prevRaw === value) return; // 기존 로컬 값과 100% 동일하면 클라우드 PUT / meta 갱신 발생 안 함!
    var c = getCloudConfig();
    if (!c) return;
    try {
      var curPid = pageId();
      if (CONFIG_KEYS.indexOf(key) >= 0 && (curPid === 'admin' || (curPid === 'luckydraw-stage' && (key === 'hvac_luckydraw_state' || key === 'hvac_luckydraw_config')))) {
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
    if (pollTimer) clearInterval(pollTimer);
    if (!getCloudConfig()) return;
    var pId = pageId();
    // index.html 랜딩 페이지는 정적 스케줄/안내 페이지(site-config.json 연동)이므로 실시간 Firebase 소켓/폴링 제외 (트래픽 0B)
    if (pId === 'index') return;

    if (pId === 'checkin' && read('hvac_checkin_passcode') === null) {
      syncSingleConfigKey('hvac_checkin_passcode');
    }

    // 1. 200명 전원 실시간 SSE 소켓 스트림 연결 (초기 put 이벤트로 변경된 섹션만 차등 동기화)
    initCloudStream();

    // 2. SSE 소켓이 2.5초 내 연결되지 않은 경우에만 초기 백업 폴링 1회 수행 (중복 다운로드 방지)
    setTimeout(function () {
      if (!streamConnected) {
        pollCloudChanges(false);
      }
    }, 2500);

    // 3. 주기적 안전 백업 폴링 (소켓 단절 시에만 동작, 정상 스트림 중에는 0회 호출)
    var fastPages = ['admin', 'qna', 'attendance-dashboard', 'quiz-winners', 'game-leaderboard', 'lunch-screen', 'luckydraw-stage'];
    var intervalMs = fastPages.indexOf(pId) >= 0 ? 15000 : 30000;
    pollTimer = setInterval(function () {
      if (streamConnected && cloudEventSource && cloudEventSource.readyState === 1) return;
      pollCloudChanges(false);
    }, intervalMs);
  }

  // 모바일 화면 꺼짐 복귀 / 백그라운드 탭 전환 시 스트림 및 데이터 재연결 (3초 디바운스 + 정상 연결 시 폴링 생략)
  var lastResumeCheckAt = 0;
  function checkAndResumeStream() {
    if (pageId() === 'index') return;
    var now = Date.now();
    if (now - lastResumeCheckAt < 3000) return;
    lastResumeCheckAt = now;
    if (!getCloudConfig()) return;
    if (streamConnected && cloudEventSource && cloudEventSource.readyState === 1) {
      return;
    }
    pollCloudChanges(false);
    if (!cloudEventSource || cloudEventSource.readyState === 2 /* EventSource.CLOSED */) {
      initCloudStream();
    }
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
        var hasCache = read(cacheKeyMap[sec]) !== null;
        var needSync = !hasCache || !lastSeenMeta[sec] || (latestRemoteMeta[sec] && latestRemoteMeta[sec] !== lastSeenMeta[sec]);
        if (!needSync) return Promise.resolve(false);
        lastSeenMeta[sec] = latestRemoteMeta[sec] || Date.now();
        saveLastSeenMeta();
        return syncSpecificSection(sec, true);
      },
      isActive: function () { var c = getCloudConfig(); return !!(c && c.enabled && c.dbUrl); },
      isStreamConnected: function () { return !!streamConnected; },
      saveConfig: function (cfg) { writeLocalSilent(CLOUD_CFG_KEY, cfg); startCloudLoop(); },
      cloudPath: cloudPath,
      lookupRosterEntry: function (email) {
        if (!email) return Promise.resolve(null);
        var cleanEmail = String(email).toLowerCase().replace('@lge.com', '').trim();
        var cleanKey = cleanEmail.replace(/[.#$\[\]\/]/g, '_');
        var localRoster = read('hvac_roster_list');
        if (Array.isArray(localRoster) && localRoster.length > 0 && !localRoster.some(function (r) { return r && r.email === 'user1'; })) {
          var found = localRoster.find(function (r) {
            return String(r.email || '').toLowerCase().replace('@lge.com', '').trim() === cleanEmail;
          });
          if (found) return Promise.resolve(found);
        }
        if (!window.fetch || !getCloudConfig()) return Promise.resolve(null);
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
