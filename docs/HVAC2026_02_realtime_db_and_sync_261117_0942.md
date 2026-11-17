# 02. Firebase Realtime Database 스키마, 동시성 제어 및 트래픽 최적화

본 문서는 세미나 웹 앱의 백엔드 역할을 수행하는 **Firebase Realtime Database(RTDB)** 데이터 모델, 동시 접속 트랜잭션 설계, 그리고 다운로드 트래픽 최적화 구조를 정리한 기술 문서입니다.

---

## 1. RTDB 데이터 트리 구조 (`/<roomKey>/...`, 기본값 `hvac2026`)

```text
hvac2026/
├── meta/                              # 각 섹션 최신 변경 시각(epoch ms) 신호 허브 (~537 B)
│   ├── checkins: <number>
│   ├── qna: <number>
│   ├── quiz: <number>
│   ├── games: <number>
│   ├── config: <number>
│   ├── config_keys/                   # 설정 키별 개별 변경 타임스탬프 (핀포인트 동기화용)
│   │   ├── hvac_schedule_settings: <number>
│   │   ├── hvac_quiz_unlocked_sessions: <number>
│   │   ├── hvac_game_config: <number>
│   │   ├── hvac_notice_banner: <number>
│   │   ├── hvac_luckydraw_config: <number>
│   │   ├── hvac_luckydraw_state: <number>
│   │   └── ...
│   ├── session_reset_at: <number>     # 전체 강제 체크아웃 시그널
│   └── quiz_reset_at: <number>        # 전체 퀴즈 초기화 시그널
│
├── config/                            # 동적·정적 설정 저장소 (~21 KB)
│   ├── hvac_schedule_settings         # 세션 상태(live/done/upcoming), 자료 링크 등
│   ├── hvac_quiz_unlocked_sessions    # 오픈된 퀴즈 세션 배열 (예: [0,1,2,3,4,5])
│   ├── hvac_quiz_config               # 퀴즈 문항 목록
│   ├── hvac_quiz_scoring_policy       # 시도 횟수별 배점 정책 (1.0 / 0.7 / 0.4)
│   ├── hvac_game_config               # 게임 활성화, 블라인드 시점, 목표 온도, 최대 도전 횟수
│   ├── hvac_luckydraw_config          # 경품 등급/인원/옵션(설문 제한, 순번 당첨자 제외 등)
│   ├── hvac_luckydraw_state           # 추첨 진행 결과 (drawnTiers, confirmedTiers, deliveredMilestones)
│   ├── hvac_milestone_events          # 순번(Seq) 마일스톤 경품 대상 순번 설정
│   ├── hvac_notice_banner             # 상단 긴급 공지 배너 페이로드
│   ├── hvac_checkin_passcode          # 현장 출석 인증코드 (필요 시)
│   └── hvac_super_admin_hash          # 추첨 롤백/초기화 2차 보안 비밀번호 SHA-256 해시
│
├── checkins/                          # 현장 출석부 (~108 KB)
│   ├── seqCounter: <number>           # 사전등록/현장 임직원 원자적 순번 카운터
│   ├── seqCounter_walkin: <number>    # 현장 등록 전용 카운터 (200번대 등)
│   ├── seqCounter_external: <number>  # 외부 초청 인원 (500번대)
│   ├── seqCounter_vip: <number>       # VIP 초대 인원 (700번대)
│   ├── seqCounter_him: <number>       # 하이엠솔루텍 인원 (900번대)
│   ├── seqCounter_operator: <number>  # 운영진 (300번대)
│   ├── blocked: [ "<cleanEmail>" ]    # 중복 삭제 / 테스트 계정 / 럭키드로우·퀴즈 제외 목록
│   └── items/
│       └── <emailKey>/                # `@lge.com` 제거 및 특수문자 치환된 소문자 키
│           ├── seq, checkinId, name, dept, position, email
│           ├── category (`pre` | `walkin` | `external` | `vip` | `him` | `operator`)
│           ├── activeDeviceId, sessionToken, giftStatus, giftReceivedAt
│           └── checkinTime, checkinTimeMs
│
├── gift_receipts/                     # 기념품 1인 1회 수령 원자적 영수증 (~33 KB)
│   └── <emailKey>/ { giftStatus, giftReceivedAt, claimedAt, meta }
│
├── roster/ & roster_map/              # 사전 등록 명부(배열 및 emailKey 단건 O(1) 조회용 ~200B/건)
├── operators/                         # 운영진 이메일 화이트리스트
│
├── qna/list/                          # 실시간 질문 배열 (~7 KB)
│   └── [ { id, session, sessionName, content, author, checkinSeq, likes, isPinned, isAnswered, time, timestamp } ]
│
├── quiz/
│   ├── locked_winners/                # 세션별 당첨자 영구 고정(Lock) 맵 { "1": [winner1, winner2] }
│   └── submissions/                   # 참가자별 퀴즈 응시 이력 (~160 KB)
│       └── <emailKey>/
│           ├── name, email, seq, checkinId, dept, category
│           ├── score, answeredCount, firstTryCount, retryCount, isLocked
│           ├── sessionScores: [s0, s1, s2, s3, s4, s5]
│           ├── sessionAnswered: [a0, a1, a2, a3, a4, a5]
│           ├── sessionTimestamps: [t0, t1, t2, t3, t4, t5]  # 세션별 최초 완료 시각(불변 보존)
│           ├── answers: { <qId>: { attemptCount, attempts, finalOpt, isDone, score, status } }
│           └── timestamp, lastModifiedAt, updatedAt
│
└── games/
    ├── top3/                          # 전광판·모바일 미니보드 전용 초경량 요약 (~450 B)
    │   └── { top10s: [...], top26c: [...], count10s, count26c, updatedAt }
    └── submissions/                   # 참가자별 3회 도전 기록 상세 (~90 KB)
        └── <emailKey>/
            ├── key, name, dept, seq, checkinId, isBlocked
            ├── game10s: { tries, bestTime, bestDiff, records: [{ val, diff, ts }] }
            └── game26c: { tries, bestTemp, bestDiff, records: [{ val, diff, ts }] }
```

> **보안 규칙 ([database.rules.json](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/database.rules.json))**:
> - `checkins/items/$emailKey`는 기존 `activeDeviceId`가 일치하거나 `admin_console`인 경우에만 갱신 가능(타인 사칭 덮어쓰기 차단), `surveys/$responseId`는 `!data.exists()`(불변) 검증을 적용합니다.

---

## 2. 대규모(200명 동시) 동시성 및 무결성 설계

1. **원자적 순번 채번 (`ETag` 기반 낙관적 락)**
   - 체크인 시 `X-Firebase-ETag: true` 헤더로 `seqCounter`를 읽고 `If-Match: <etag>` 조건부 `PUT`을 수행합니다. 충돌(HTTP `412 Precondition Failed`) 시 자동 재시도해 200명이 동시에 QR 체크인을 해도 순번 중복(`No. N`)이 발생하지 않습니다.
2. **기념품 이중 수령 방지 (`gift_receipts/<emailKey>`)**
   - `cloudVerifyAndClaimGift()`가 `gift_receipts/<emailKey>`를 선조회한 뒤 미수령 상태일 때만 영수증을 발급하고 `checkins/items/<emailKey>`를 동기화합니다.
3. **미니게임 200명 동시 제출 + Top 3 경합 방지 (`games/top3` ETag 트랜잭션)**
   - 참가자는 **본인의 노드**(`games/submissions/<emailKey>`)에만 `PUT`하므로 타인의 점수와 충돌하지 않습니다.
   - `games/top3` 요약 노드 갱신에는 `X-Firebase-ETag` + `If-Match` 조건부 `PUT`(최대 5회 백오프 재시도)을 사용해 200명이 동시에 1~3위권을 경합해도 Top 3 목록과 참여자 카운트가 유실되지 않습니다.
   - 또한 **최대 시도 횟수(3회) 초과 차단**: `tries` 카운트를 서버 기록과 병합 검증하고, `localStorage` 초기화/새로고침 시에도 `fetchMyGameRecord()`로 서버 기록을 복원해 재도전을 막습니다.
4. **퀴즈 1인 1기기 잠금 & 세션별 독립 타임스탬프**
   - `deviceId`를 대조해 최초 제출 기기와 다른 기기에서의 중복 제출을 차단하고, `sessionTimestamps[sNum]`을 최초 1회만 기록해 이후 세션을 풀더라도 이전 세션의 선착순 시각이 덮어씌워지지 않도록 격리했습니다.
5. **로컬-클라우드 에코백(Echo-back) 차단**
   - `Storage.prototype.setItem` 후킹 시 클라우드 수신 중에는 `withCloudSyncLock` 카운터를 올려 클라우드에서 받은 데이터를 다시 클라우드로 `PUT`하는 무한 루프를 원천 차단합니다.

---

## 3. Firebase RTDB 다운로드 사용량 최적화 아키텍처

200명 이상의 참가자와 다수의 관리자/전광판 탭이 동시에 열려 있어도 무료/소규모 요금제 한도 내에서 쾌적하게 동작하도록 다층 최적화가 적용되어 있습니다.

1. **단일 `/meta.json` SSE(`EventSource`) 허브 + 핀포인트 동기화**
   - 무거운 데이터 노드를 직접 스트리밍하지 않고 ~537 B 크기의 `/meta.json`만 `EventSource`로 구독합니다.
   - 설정 변경 시 `meta/config_keys/<key>`만 갱신하므로, 퀴즈 세션 하나를 오픈하면 200명의 클라이언트는 21 KB 전체 `config` 대신 ~10 B의 `hvac_quiz_unlocked_sessions` 단일 키만 내려받습니다.
2. **참가자 단건 핀포인트 조회 (개인정보 보호 + 99% 트래픽 절감)**
   - 일반 참석자 페이지는 `checkins` 전체(108 KB), `quiz/submissions` 전체(160 KB), `games/submissions` 전체(90 KB)를 절대 다운로드하지 않습니다.
   - 대신 `checkins/items/<me>` (~200 B), `roster_map/<me>` (~200 B), `quiz/submissions/<me>` (~1 KB), `games/submissions/<me>` (~400 B), 전광판은 `games/top3` (~450 B)만 조회합니다.
3. **`localStorage` 기반 영속 메타 캐시 (`0B` 캐시 히트)**
   - `hvac_last_seen_meta`와 `hvac_last_seen_cfgkeys`를 페이지 역할별 키(`checkins_full` vs `checkins_self`, `quiz_full` vs `quiz_self`, `games_full` vs `games_top3`) 및 `roomKey`·`selfEmail` 기준으로 `localStorage`에 영속 저장합니다.
   - 페이지를 새로고침하거나 메뉴 간 이동을 해도 서버의 `meta` 타임스탬프가 변하지 않았다면 **다운로드 0B**로 즉시 캐시를 재사용합니다.
4. **SSE 활성 시 불필요한 백그라운드 폴링 제거**
   - 일반 참석자 페이지(`checkin`, `qna`, `quiz`, `game`, `game-leaderboard`)는 SSE(`readyState === 1`) 연결 중 **백그라운드 폴링을 0건**으로 중지합니다.
   - 호스트/전광판/관리자 페이지(`admin`, `luckydraw-stage`, `mc-qna`, `attendance-dashboard`, `quiz-winners`)도 SSE 연결 중에는 **30초 간격 경량 헬스체크**만 수행하고, 연결이 끊겼을 때만 6초 폴백 폴링을 가동합니다.
5. **관리자 콘솔 활성 탭 지연 동기화(Lazy Sync) + 대용량 8초 배칭**
   - 관리자 페이지(`admin`)는 상단 Q&A 배지를 위한 `qna`·`config`만 상시 수신하고, 대용량 섹션(`checkins` 108 KB, `quiz` 160 KB, `games` 90 KB)은 **현재 보고 있는 탭에 해당할 때만** 실시간 동기화합니다. 다른 탭 클릭 시 `HVAC.cloud.syncAdminTab(tabId)`가 `meta` 타임스탬프를 선비교해 변경분이 있을 때만 내려받습니다.
   - 퀴즈/체크인/게임 동시 제출이 몰리는 피크 시간에는 `HEAVY_SYNC_COOLDOWN_MS (8000ms)` 트레일링 배칭을 통해 전광판/관리자 화면의 대용량 재다운로드 빈도를 제한합니다.
