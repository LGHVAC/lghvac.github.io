# 01. 전체 시스템 아키텍처 및 페이지/파일 구성

본 문서는 **LG전자 2026 HVAC Engineering Expert Seminar (제10회)** 세미나 운영 웹 플랫폼의 전체 아키텍처와 파일 구조를 정리한 기준서입니다. 차기 세미나 프로젝트 구축 시 기본 청사진(Blueprint)으로 활용할 수 있도록 구성했습니다.

---

## 1. 기술 스택 및 배포 아키텍처

- **프론트엔드 / 호스팅**: 순수 HTML5 / CSS3 / Vanilla ES6+ JavaScript 기반 정적 웹 애플리케이션 (**GitHub Pages** + 커스텀 도메인 [CNAME](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/CNAME))
  - 빌드 도구(Webpack/Vite 등) 없이 브라우저에서 즉시 실행 가능하며, 외부 JS 의존성을 최소화했습니다.
- **실시간 클라우드 DB**: **Firebase Realtime Database (RTDB)** REST API + Server-Sent Events(`EventSource`) 하이브리드 브릿지 ([hvac-core.js](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/assets/hvac-core.js))
  - SDK WebSocket 상시 연결(Spark 플랜 100 동시 연결 제한) 대신 HTTP REST + `/meta.json` 단일 SSE 스트림을 사용해 200명 이상 동시 접속 환경에서도 안정적으로 동작합니다.
- **정적 설정 프리로드**: [site-config.json](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/site-config.json) (GitHub Pages CDN 제공)
  - 일정표, 퀴즈 문항, 테마, 공식 링크 등 대용량 정적 설정을 Firebase가 아닌 정적 JSON에서 먼저 로드해 RTDB 트래픽을 절감합니다.
- **관리자 콘솔 보안 암호화**: [admin.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/admin.html) + [assets/admin-core.enc](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/assets/admin-core.enc)
  - 평문 관리자 소스([src/admin-core.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/src/admin-core.html))는 `.gitignore`로 저장소에 커밋하지 않고, `PBKDF2 (100,000 iters, SHA-256) + AES-256-GCM`으로 암호화한 바이너리 번들만 배포합니다([scripts/build-admin.js](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/scripts/build-admin.js)).

---

## 2. 디렉터리 및 핵심 파일 구조

```text
10th-HVAC/
├── index.html                    # 행사 공식 랜딩·프로그램·연사·오시는 길 안내 페이지 (RTDB 미연결, 0B)
├── checkin.html                  # 참석자 모바일 체크인(QR)·일정·자료뷰어·미션 허브
├── qna.html                      # 참석자 모바일 실시간 세션 Q&A 등록/공감 보드
├── mc-qna.html                   # 사회자(MC) 전용 대형 Q&A 진행·추천 고정·타이머 화면
├── quiz.html                     # 참석자 모바일 세션별 퀴즈 응시 화면 (오프닝~세션5)
├── quiz-winners.html             # 세션별 퀴즈 당첨자(1·2위) 실시간 집계 전광판
├── game.html                     # 참석자 점심 미니게임 (10.00초 맞추기 / 20.0℃ 맞추기, 3회 제한)
├── game-leaderboard.html         # 미니게임 실시간 Top 3 대형 리더보드 전광판 (lunch-screen.html 리다이렉트)
├── lunch-screen.html             # 미니게임 리더보드 진입 리다이렉터
├── attendance-dashboard.html     # 현장 실시간 출석·기념품 수령률·순번 마일스톤 현황 대시보드
├── luckydraw-stage.html          # 사회자·프로젝터용 럭키드로우 추첨 무대 전광판
├── survey.html                   # 만족도 설문 진입점 (MS Forms 외부 설문 링크로 자동 리다이렉트)
├── admin.html                    # 관리자 인증 게이트웨이 (비밀번호 입력 → admin-core.enc WebCrypto 복호화 마운트)
├── site-config.json              # 배포용 정적 기본 설정 (세션/퀴즈/테마/링크)
├── version.json                  # 앱 최신 빌드 버전 (`YYYYMMDD_HHMM` 형식) — 전 클라이언트 자동 업데이트 배너 기준
├── database.rules.json           # Firebase Realtime Database 보안 및 인덱싱 규칙
├── firebase.json                 # Firebase Database Rules 배포 설정
├── CNAME                         # 커스텀 도메인 설정
├── qr/
│   └── index.html                # 현장 인쇄·배치용 스마트 QR 안내판 생성 페이지
├── assets/
│   ├── hvac-core.js              # 전 페이지 공통 코어 (클라우드 동기화, ETag 트랜잭션, DRM 뷰어, 알림 모달)
│   ├── hvac-common.css           # 공통 스타일시트
│   ├── admin-core.enc            # AES-256-GCM 암호화된 관리자 콘솔 번들
│   └── (이미지 / QR / 연사 프로필 / 약도 에셋)
├── scripts/
│   ├── build-admin.js            # admin-core.html 암호화 빌드 및 복호화 CLI
│   └── ...                       # 유지보수·내보내기 보조 스크립트
└── src/
    └── admin-core.html           # (.gitignore 대상) 관리자 콘솔 원본 HTML/JS 소스
```

---

## 3. 페이지별 역할 및 데이터 흐름 매핑 (`pageId`)

[hvac-core.js](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/assets/hvac-core.js)의 `pageId()`가 각 페이지의 `<html data-hvac-page="...">` 또는 URL 경로를 식별해 필요한 클라우드 섹션만 선별 구독합니다.

| `pageId()` | 대상 파일 | 주요 대상 | 사용하는 RTDB 섹션 / 동기화 범위 | 폴링 / 스트림 전략 |
| :--- | :--- | :--- | :--- | :--- |
| `index` | [index.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/index.html) | 외부/사전 안내 방문자 | RTDB 연결 안 함 (`site-config.json` 정적 연동) | **트래픽 0B** |
| `checkin` | [checkin.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/checkin.html) | 참석자 전원 (모바일) | `config` 동적 키, 본인 체크인 상태 (`checkins/items/<email>`, ~200B), `roster_map/<email>` | SSE 연결 중 폴링 0건 |
| `qna` | [qna.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/qna.html) | 참석자 전원 (모바일) | `config`, `qna/list` | SSE 연결 중 폴링 0건 |
| `mc-qna` | [mc-qna.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/mc-qna.html) | 사회자/운영진 (태블릿·PC) | `config`, `qna/list` | SSE + 30초 헬스체크 (끊김 시 6초) |
| `quiz` | [quiz.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/quiz.html) | 참석자 전원 (모바일) | `config`, 본인 퀴즈 제출건 (`quiz/submissions/<email>`) | SSE 연결 중 폴링 0건 |
| `quiz-winners` | [quiz-winners.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/quiz-winners.html) | 운영진/전광판 | `config`, `quiz` (전체), `checkins` (전체) | SSE + 30초 헬스체크 + 대용량 8초 배칭 |
| `game` | [game.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/game.html) | 참석자 전원 (모바일) | `config` (`hvac_game_config`), 본인 기록 (`games/submissions/<email>`, ~400B) | SSE 연결 중 폴링 0건 |
| `game-leaderboard` | [game-leaderboard.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/game-leaderboard.html) | 현장 대형 전광판 | `config`, 경량 Top 3 (`games/top3`, ~450B) | SSE 연결 중 폴링 0건 |
| `attendance-dashboard` | [attendance-dashboard.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/attendance-dashboard.html) | 안내 데스크/운영진 | `config`, `checkins` (전체) | SSE + 30초 헬스체크 + 대용량 8초 배칭 |
| `luckydraw-stage` | [luckydraw-stage.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/luckydraw-stage.html) | 사회자/무대 프로젝터 | `config` (추첨 설정/상태), `checkins` (전체) | SSE + 30초 헬스체크 + 대용량 8초 배칭 |
| `admin` | [admin.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/admin.html) | 운영 총괄 관리자 | 전 섹션 (단, `checkins`/`quiz`/`games`는 활성 탭일 때만 실시간 수신) | SSE + 30초 헬스체크 + 탭 전환 지연 동기화 |

---

## 4. 공통 UX / 프론트엔드 인프라 ([hvac-core.js](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/assets/hvac-core.js))

1. **카카오톡 인앱 브라우저 자동 탈출**
   - `KAKAOTALK` UA 감지 시 Android(`intent://...#Intent;scheme=https;package=com.android.chrome;end;`) 및 iOS(`kakaotalk://web/openExternal?url=...`) 기본 브라우저로 자동 전환해 WebStorage/SSE 호환성을 확보합니다.
2. **커스텀 다크골드 알림 모달**
   - 브라우저 기본 `window.alert()`를 오버라이드해 도메인 주소(`... says`) 노출 없는 프리미엄 다크·골드 모달(`showCustomAlert`)로 통일했습니다.
3. **긴급 공지 배너 (`hvac_notice_banner`)**
   - 관리자 발송 즉시 전 참석자 상단 배너가 노출되며, `expireAfterMs`(기본 60초 등) 경과 시 자동 소멸합니다.
4. **버전 업데이트 감지 (`checkRemoteAppVersion`)**
   - `version.json`과 페이지 내 `<script src="./assets/hvac-core.js?v=...">` 버전을 비교해 신규 배포 감지 시 하단 `"✨ 웹사이트 최신 업데이트가 적용되었습니다. 새로고침 ↻"` 배너를 띄웁니다.
5. **보안 열람 전용 문서 뷰어 (`openMaterialViewer`)**
   - Google Drive `/preview` 또는 PDF `#toolbar=0` 임베드, 우클릭·`PrintScreen`·`Ctrl+P/S/U` 차단, 포커스 이탈 시 자동 블러 가림, 참석자 실명·이메일·순번 대각선 워터마크 오버레이를 적용합니다.
