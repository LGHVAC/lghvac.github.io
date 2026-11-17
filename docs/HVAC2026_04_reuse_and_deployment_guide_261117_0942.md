# 04. 차기 세미나 재활용 및 빌드·배포 운영 가이드

본 문서는 현재 10회 세미나 프로젝트를 기반으로 **제11회 등 유사한 세미나/사내 행사 프로젝트를 새로 구축하거나 운영할 때 필요한 복제, 빌드, 배포 및 현장 운영 체크리스트**입니다.

---

## 1. 신규 세미나 복제 및 초기 세팅 순서

### Step 1. 저장소 복제 및 도메인·시드 식별자 변경
1. 저장소를 새 프로젝트(예: `11th-HVAC`)로 복제합니다.
2. [CNAME](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/CNAME) 파일의 커스텀 도메인(필요 시) 및 각 HTML의 OpenGraph 메타태그(`og:url`, `og:title`, `og:description`)를 신규 행사명으로 수정합니다.
3. **Firebase RTDB 룸 키(Room Key) 분리**:
   - 기존 `hvac2026` 데이터와 섞이지 않도록 [hvac-core.js](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/assets/hvac-core.js)의 `DEFAULT_CLOUD_CONFIG.roomKey`(예: `hvac2027`)와 [src/admin-core.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/src/admin-core.html)의 기본 `roomKey`를 새 값으로 변경합니다.
   - [database.rules.json](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/database.rules.json)의 루트 노드 이름도 동일하게(예: `"hvac2027"`) 추가·배포합니다.
4. **럭키드로우 시드 프리픽스 & 날짜 가드 업데이트**:
   - [luckydraw-stage.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/luckydraw-stage.html)의 `seedPrefix` 기본값을 새 행사명(예: `2027_HVAC_11TH`)으로 변경합니다.
   - [checkin.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/checkin.html), [quiz.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/quiz.html), [index.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/index.html)에 남아 있는 행사 날짜 가드(`2026-11-16...`)가 있다면 새 행사 일정에 맞춰 갱신하거나 제거합니다.

### Step 2. 사전 등록 명부 및 콘텐츠 교체
1. **사전 등록 명부 (`roster`, `roster_map`)**:
   - [hvac-core.js](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/assets/hvac-core.js) 내 `DEFAULT_ROSTER` / 운영진 목록을 갱신하거나, 관리자 콘솔의 사전명부 업로드 기능으로 Firebase `roster` 및 `roster_map`에 적재합니다.
   - 명부 파일 등 개인정보가 담긴 CSV/JSON은 `.gitignore` 규칙에 의해 Git에 커밋되지 않도록 주의합니다.
2. **프로그램·연사·퀴즈·외부 링크 갱신**:
   - 관리자 콘솔에서 일정표, 발표자료 URL, 퀴즈 문항, MS Forms 설문 URL, 오픈채팅 URL을 설정한 뒤 **`site-config.json` 내보내기**를 실행해 루트 [site-config.json](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/site-config.json)에 덮어씁니다.
   - 연사 사진·행사 배너·약도·카카오 QR 이미지는 `assets/` 폴더에 교체합니다.

---

## 2. 관리자 콘솔 암호화 빌드 및 버전 관리 워크플로우

관리자 코어([src/admin-core.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/src/admin-core.html))는 `.gitignore`에 의해 소스 저장소에 올라가지 않으며, 암호화 번들([assets/admin-core.enc](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/assets/admin-core.enc))만 배포됩니다.

### 2.1 관리자 소스 복호화 / 암호화 명령 ([scripts/build-admin.js](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/scripts/build-admin.js))
```bash
# 1) 암호화된 번들에서 src/admin-core.html 복원 (수정 전 1회)
node scripts/build-admin.js decrypt <관리자_비밀번호>

# 2) src/admin-core.html 수정 후 암호화 번들(assets/admin-core.enc) 재생성
node scripts/build-admin.js build <관리자_비밀번호>
```
> **주의**:
> - `admin.html`의 게이트웨이 비밀번호와 `build-admin.js build <비밀번호>`의 암호가 일치해야 브라우저에서 복호화할 수 있습니다.
> - 차기 행사에서 관리자 비밀번호를 변경할 경우 `admin.html` 내 검증 로직과 `build-admin.js` 빌드 키를 함께 맞춥니다.

### 2.2 캐시 무효화 및 배포 절차
GitHub Pages 및 모바일 브라우저(iOS/Android/카카오톡)의 강력한 HTML/JS 캐시를 뚫고 즉시 업데이트를 반영하기 위해 다음 순서를 지킵니다.
1. 수정된 모든 HTML·JS 파일에 대해 **Node `vm.Script` 문법 검사**를 수행합니다.
2. [version.json](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/version.json)과 [site-config.json](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/site-config.json)의 `publishedAt`, 그리고 각 HTML 파일 내 `hvac-core.js?v=<YYMMDD_HHMM>` 쿼리스트링을 현재 시각 버전으로 일괄 갱신합니다.
3. `src/admin-core.html`을 수정한 경우 반드시 `node scripts/build-admin.js build <비밀번호>`로 `assets/admin-core.enc`를 재빌드합니다.
4. `git add .` → `git commit` → `git push origin main` 실행 시 GitHub Pages가 약 1~2분 내 자동 배포하며, 이미 접속 중인 클라이언트 하단에 `"✨ 웹사이트 최신 업데이트가 적용되었습니다. 새로고침 ↻"` 배너가 자동 노출됩니다.

---

## 3. 보안 및 개인정보 보호 원칙 ([.gitignore](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/.gitignore))

- **원천 차단 패턴**: `*.csv`, `*.xlsx`, `*attendance*`, `*checkin*`, `*roster*`, `*attendee*`, `*winner*`, `*backup*.json`, `src/admin-core.html`, `.env`, `firebase-credentials.json`
- **웹 페이지 예외 허용**: `!checkin.html`, `!attendance-dashboard.html`, `!quiz-winners.html`
- **운영 주의**: CSV 다운로드 및 JSON 백업 파일은 작업 폴더 바깥 또는 `.gitignore`에 매칭되는 이름(`*backup*.json`)으로만 저장하여 실수로 임직원 성명·이메일이 공개 GitHub 저장소에 올라가지 않도록 합니다.

---

## 4. 행사 당일 운영 런북 (Runbook)

| 시점 | 담당 화면 | 주요 수행 액션 |
| :--- | :--- | :--- |
| **행사 전날 / D-Day 08:00** | `admin.html`, `qr/index.html` | 테스트 더미·테스트 출석/퀴즈/게임 데이터 **완전 초기화**, 사전 명부 확인, 현장 QR 배너 인쇄 배치, `hvac_super_admin_hash` 확인 |
| **오전 등록 (08:30~)** | `attendance-dashboard.html`, `admin.html` | 실시간 출석 체크인 모니터링, 현장 추가 등록(`walkin`) 및 외부/VIP/하이엠 분류 보정, 기념품 수령 처리 및 순번 마일스톤 이벤트 진행 |
| **강연 중 (세션 1~5)** | `admin.html`, `mc-qna.html` | 세션 상태 전환(`진행중` ↔ `완료`), 사회자 `mc-qna.html`로 질문 채택/답변완료 처리 |
| **각 세션 종료 직후** | `admin.html`, `quiz-winners.html` | 해당 세션 퀴즈 오픈(`🔓`) → 공지 배너 자동 발송 → 마감 후 **`🔒 1·2위 당첨자 확정`** 으로 순위 영구 고정 |
| **점심시간 (12:30~)** | `admin.html`, `game-leaderboard.html` | 관리자 `미니게임` 탭에서 **게임 활성화**, 대형 전광판에 `game-leaderboard.html` 송출, 종료 시 마감/잠금 |
| **클로징 세션** | `luckydraw-stage.html`, MS Forms | 만족도 서베이 링크 안내 → 프로젝터에 `luckydraw-stage.html` 띄우고 3등→2등→1등 순서대로 럭키드로우 진행 (부재자 재추첨/추가 추첨 포함) |
| **행사 종료 후** | `admin.html`, `quiz-winners.html` | 출석부·Q&A·퀴즈 성적·퀴즈 당첨자·미니게임·럭키드로우 결과 CSV 및 JSON 백업 일괄 다운로드 |
