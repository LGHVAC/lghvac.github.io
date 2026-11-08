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

  var CONFIG_KEYS = [
    'hvac_schedule_settings',
    'hvac_theme_settings',
    'hvac_site_links',
    'hvac_site_content',
    'hvac_quiz_config',
    'hvac_quiz_unlocked_sessions',
    'hvac_quiz_scoring_policy',
    'hvac_notice_banner',
    'hvac_milestone_events'
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
    { key: 'mapUrl', test: function (h) { return /map\.naver\.com|map\.kakao\.com|maps\.google/.test(h); } }
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
      if (!url && key === 'kakaoChat' && links.kakaoChannel) url = links.kakaoChannel.replace(/\/$/, '') + '/chat';
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

    var dismissKey = 'hvac_banner_dismissed';
    try {
      if (sessionStorage.getItem(dismissKey) === String(cfg.updatedAt || cfg.text)) return;
    } catch (e) {}

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

    bar.querySelector('button').addEventListener('click', function () {
      try { sessionStorage.setItem(dismissKey, String(cfg.updatedAt || cfg.text)); } catch (e) {}
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
  function getCloudConfig() {
    // URL 파라미터 ?db=... 로 임시 연결 테스트 지원 (코드/Git 노출 방지)
    try {
      var params = new URLSearchParams(location.search);
      var paramDb = params.get('db');
      if (paramDb && /^https:\/\/[a-z0-9-]+.*\.(firebaseio\.com|firebasedatabase\.app)/i.test(paramDb)) {
        var existing = read(CLOUD_CFG_KEY) || {};
        existing.enabled = true;
        existing.dbUrl = paramDb.replace(/\/+$/, '');
        writeLocalSilent(CLOUD_CFG_KEY, existing);
      }
    } catch (e) {}
    var cfg = read(CLOUD_CFG_KEY);
    if (!cfg || !cfg.enabled || !cfg.dbUrl) return null;
    var cleanUrl = String(cfg.dbUrl).trim().replace(/\/+$/, '');
    if (!/^https:\/\//i.test(cleanUrl)) return null;
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

  var lastSeenMeta = { config: 0, checkins: 0, qna: 0, quiz: 0 };
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

  // 참석자 체크인: ETag 기반 원자적 순번(1~200+) 발급 및 클라우드 등록
  function cloudCheckin(attendee) {
    var c = getCloudConfig();
    if (!c || !window.fetch) return Promise.resolve(null);

    var cleanEmail = String(attendee.email || '').toLowerCase().replace('@lge.com', '').replace(/[.#$\[\]\/]/g, '_');
    var existingUrl = cloudPath('checkins/items/' + cleanEmail);

    // 1) 이미 체크인한 사용자인지 먼저 확인 (재접속 시 기존 순번 유지)
    return fetch(existingUrl, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (existing) {
        if (existing && existing.seq) {
          var updated = Object.assign({}, existing, attendee, {
            seq: existing.seq,
            checkinId: existing.checkinId || ('HVAC-' + String(existing.seq).padStart(3, '0')),
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

        // 2) 신규 체크인: ETag CAS 트랜잭션으로 원자적 순번 증가 (최대 6회 재시도)
        var counterUrl = cloudPath('checkins/seqCounter');
        function allocateSeq(attempt) {
          return fetch(counterUrl, { headers: { 'X-Firebase-ETag': 'true' }, cache: 'no-store' })
            .then(function (res) {
              var etag = res.headers.get('ETag');
              return res.json().then(function (curVal) {
                var nextSeq = (typeof curVal === 'number' && curVal > 0 ? curVal : 0) + 1;
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
          var milestones = read('hvac_milestone_events') || [
            { seq: 10, prize: '스타벅스 e-Gift 카드 (1만원권)' },
            { seq: 50, prize: 'LG 프리미엄 써모 텀블러' },
            { seq: 77, prize: '신세계 모바일 상품권 (3만원권)' },
            { seq: 100, prize: 'LG 퓨리케어 미니 공기청정기' }
          ];
          var matched = milestones.find(function (m) { return parseInt(m.seq, 10) === seq; });
          var record = Object.assign({}, attendee, {
            seq: seq,
            checkinId: 'HVAC-' + String(seq).padStart(3, '0'),
            isMilestoneWinner: !!matched,
            milestonePrize: matched ? matched.prize : ''
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

  // 퀴즈 점수 클라우드 전송 (참석자 퀴즈 풀이 시)
  function pushQuizScoreToCloud(scoreObj) {
    var c = getCloudConfig();
    if (!c || !window.fetch || !scoreObj) return Promise.resolve(false);
    var user = read('hvac_user_checked') || {};
    var key = String(user.email || scoreObj.deviceId || 'anon_' + Date.now()).toLowerCase().replace('@lge.com', '').replace(/[.#$\[\]\/]/g, '_');
    var record = {
      email: user.email || '익명(미체크인)',
      name: user.name || '미체크인 참가자',
      empNo: user.empNo || user.employeeId || '',
      dept: user.dept || '',
      seq: user.seq || null,
      checkinId: user.checkinId || '-',
      score: scoreObj.score || 0,
      answeredCount: scoreObj.answeredCount || 0,
      firstTryCount: scoreObj.firstTryCount || 0,
      retryCount: scoreObj.retryCount || 0,
      total: scoreObj.total || 6,
      updatedAt: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    };
    return fetch(cloudPath('quiz/submissions/' + key), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record)
    }).then(function (r) {
      if (r.ok) return touchCloudMeta('quiz').then(function () { return true; });
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
                // 로컬 공감(isLiked) 표시 유지 병합
                var localQna = read('hvac_qna_list') || [];
                var likedMap = {};
                localQna.forEach(function (q) { if (q && q.isLiked) likedMap[q.id] = true; });
                remoteQna.forEach(function (q) { if (q && likedMap[q.id]) q.isLiked = true; });
                writeLocalSilent('hvac_qna_list', remoteQna);
                window.dispatchEvent(new StorageEvent('storage', { key: 'hvac_qna_list' }));
              })
          );
        }

        // 3) 출석 명부 변경 감지 (admin 및 checkin 차단 확인용)
        if ((pId === 'admin' || pId === 'checkin') && (forceAll || (meta.checkins && meta.checkins > lastSeenMeta.checkins))) {
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
    var intervalMs = (pageId() === 'admin' || pageId() === 'qna') ? 4000 : 8000;
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
    return payload;
  }

  window.HVAC = {
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
    cloud: {
      getConfig: getCloudConfig,
      poll: pollCloudChanges,
      pushAllConfigs: pushAllConfigsToCloud,
      pushCheckinList: pushCheckinListToCloud,
      pushQnaList: pushQnaListToCloud,
      checkin: cloudCheckin,
      pushQuizScore: pushQuizScoreToCloud,
      restart: startCloudLoop
    },
    onConfigUpdated: function (fn) {
      window.addEventListener('hvac:config-updated', function (e) {
        try { fn((e.detail && e.detail.keys) || CONFIG_KEYS); } catch (err) { console.warn(err); }
      });
    }
  };
})();
