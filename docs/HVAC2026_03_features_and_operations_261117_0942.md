# 03. 주요 기능 명세 및 세미나 운영 비즈니스 로직

본 문서는 세미나 현장에서 실제로 동작하는 **참가자 기능, 관리자 콘솔 9개 탭, 퀴즈·미니게임 순위 산정, 럭키드로우 공정 추첨 알고리즘**을 정리한 기능 명세서입니다.

---

## 1. 참가자 모바일 여정 (`index.html`, `checkin.html`, `qna.html`, `quiz.html`, `game.html`)

### 1.1 스마트 출석 체크인 ([checkin.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/checkin.html))
- **이메일 기반 사전 등록 자동 매칭**: `roster_map/<emailKey>`에서 사전 등록 명부를 0.1초 내 매칭하고, 미등록 참석자는 현장 등록(`walkin`, 200번대)으로 자동 채번합니다.
- **카테고리/순번 대역 분리**:
  - `pre` (사전등록 임직원): 1번대~
  - `walkin` (현장등록 임직원): 200번대
  - `operator` (운영진): 300번대
  - `external` (외부 초청 강사·교수 등): 500번대
  - `vip` (VIP 초대): 700번대
  - `him` (하이엠솔루텍): 900번대
- **동일인 기기 전환 확인**: 이미 다른 기기에서 출석된 계정으로 접속 시 성명 일치 검증 후 본인 확인(`allowDeviceTakeover`)을 거쳐 세션을 전환합니다.
- **현장 대시보드 및 3대 미션**: 현재 진행 중인 세션 라이브 표시, 발표자료 보안 열람(Read-Only DRM 뷰어), 퀴즈/만족도 서베이 이동, 기념품 수령 바코드/상태 확인을 제공합니다.

### 1.2 실시간 세션 Q&A (`qna.html` & `mc-qna.html`)
- 세션 선택 후 질문 등록 시 `qna/list`에 즉시 반영되며, 다른 참석자의 질문에 **공감(좋아요)** 을 누를 수 있습니다.
- 사회자 화면([mc-qna.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/mc-qna.html))은 세션 필터, 공감순/최신순 정렬, **사회자 채택(`⭐`) 상단 고정**, **답변완료 처리(`✅`)**, **Q&A 타이머(5분 등)**, 폰트 크기 조절(`A-/A+`)을 제공합니다.

### 1.3 세션별 퀴즈 및 스타벅스 당첨자 집계 (`quiz.html` & `quiz-winners.html`)
- **세션 릴리즈 제어**: 세션 0(오프닝 연습) ~ 세션 5까지 관리자가 각 세미나 세션 종료 시점에 개별 오픈/잠금합니다.
- **차등 배점 정책 (`hvac_quiz_scoring_policy`)**: 1차 정답 `1.0점`, 2차 정답 `0.7점`, 3차+ 정답 `0.4점` (오프닝 세션 0은 연습용, 세션 1~5 정식 집계).
- **당첨자 산정 및 중복 수령 방지 (`computeAllSessionQuizTop3`)**:
  1. **자격 검증 (`isQuizWinnerEligible`)**: 차단(`hvac_blocked_users`), 사외/외부 인원, 운영진 제외.
  2. **정렬 기준**: ① 세션 최고 점수(만점 `2점` 우선) → ② 해당 세션 최초 완료 시각(`sessionTimestamps[sNum]` 오름차순, 동초 시 밀리초(`.ms`) 구분 표기) → ③ 체크인 순번(`seq`) 오름차순.
  3. **차순위 자동 승계**: 이전 세션에서 이미 1·2위로 당첨된 참가자는 다음 세션 후보에서 자동 제외되고 차순위자에게 승계됩니다.
  4. **세션별 당첨자 영구 확정(Lock)**: 관리자가 `🔒 1·2위 당첨자 확정` 실행 시 `quiz/locked_winners/<sNum>`에 명단이 영구 고정되어 이후 제출자의 변동 영향을 받지 않습니다(수동 지정 및 해제도 지원).

### 1.4 점심시간 미니게임 (`game.html` & `game-leaderboard.html`)
- **2종 미니게임**:
  - **10.00초 스톱워치 챌린지**: 5초(또는 관리자 설정 시점) 이후 타이머 숫자를 가리는 **블라인드 모드** 적용(체크 해제 잠금).
  - **겨울철 적정온도(20.0℃) 맞추기**: 스텝 버튼(`±0.1℃`, `±0.5℃`) 또는 슬라이더로 목표 온도 맞추기.
- **공정 규칙 및 동시성**:
  - 종목별 **1인 3회 제한** (새로고침 시 클라우드 `games/submissions/<emailKey>` 복원으로 3회 초과 차단).
  - 3회 중 최고 기록(`Best`)을 자동 추출하며, **동점(예: 10.00초 / 20.0℃ 만점) 발생 시 해당 최고 기록을 먼저 달성한 시각(`bestAchievedAt`) 순**으로 1~3위를 정렬합니다.
  - 리더보드 전광판([game-leaderboard.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/game-leaderboard.html))은 450 B 초경량 `games/top3` 노드만 실시간 구독합니다.

### 1.5 모바일 만족도 서베이 (`survey.html`)
- 행사 직전/당일 외부 **Microsoft Forms** 설문 URL로 연결되며, [checkin.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/checkin.html), [quiz.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/quiz.html), 카카오 공지 프리셋 및 [survey.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/survey.html) 직접 진입 시에도 자동 리다이렉트(`?admin_preview=1` 제외)됩니다.

---

## 2. 럭키드로우 공정 추첨 엔진 ([luckydraw-stage.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/luckydraw-stage.html))

### 2.1 추첨 대상자 필터링 기준 (`getEligibleCandidates`)
- **포함 대상**: 현장 체크인을 완료한 **사전 등록 임직원(`pre`) 및 현장 등록 임직원(`walkin`)** (운영진 포함 여부 옵션 제어).
- **원천 제외 대상**:
  - 외부 초청 인원 (`external` 카테고리 / `500~699`번대 / 강사·교수·학생 등)
  - VIP 초대 인원 (`vip` 카테고리 / `700~899`번대)
  - 하이엠솔루텍 인원 (`him` 카테고리 / `900~999`번대 / `him.co.kr`)
  - 중복 삭제·블록 처리된 인원 (`checkins/blocked`)
  - 옵션 연동: 이전 등수 기당첨자(이메일·체크인 ID·순번 3중 대조), N번째 순번 마일스톤 당첨자 제외(`excludeMilestones`), 설문 완료자 한정(`requireSurvey`).

### 2.2 암호학적 시드 및 셔플 알고리즘
- **동적 시드 생성**: 추첨 실행 시점의 `Seed Prefix` + `정확한 밀리초 타임스탬프(Date.now())` + `등수(Rank)` + `후보자 목록 해시(Candidate Hash)`를 결합해 `hashString53()`으로 32-bit 정수 시드(`SEED-...`)를 산출합니다.
- **무작위 셔플**: **Mulberry32 PRNG** + **Fisher-Yates 알고리즘(`seededShuffle`)** 으로 후보자 전체를 균등 셔플해 상위 N명을 선정합니다.
- **무대 연출 및 사후 처리**:
  - Web Audio API 자체 신디사이저 효과음(`StageSound`) + 다단계 슬롯 고속 롤링/감속/2배 줌 서스펜스/폭죽(`runConfettiEffect`) + 1등 스포트라이트 연출.
  - **부재자 1명 재추첨(`redrawSingleWinner`)** 및 **추가 추첨 `+1명`(`addSingleWinner`)**, **현장 특별 추첨 생성(`extraDrawModal`)** 모두 동일한 서스펜스 시각화·사운드 엔진(`playSingleSlotDramaticReveal`)을 사용합니다.
  - **상단 대상 인원 표기**: 전체 체크인 수가 아닌 발표 시작 시점의 적격 대상 풀(`baseEligibleCount`) 기준으로 잔여 인원(`165명 (166명 중 이전 당첨자 1명 제외)`)을 표시합니다.
  - **추첨 로직 안내 팝업(`#drawLogicModal`)**: 상단 `Seed` 배지 옆 `ℹ️ 추첨 로직` 버튼으로 읽기 전용 검증 모달을 띄울 수 있습니다(모달 오픈 중 스페이스바 단축키 오동작 가드 적용).
  - **슈퍼관리자 2차 보안 인증**: 등수 롤백 및 전체 초기화 시 `#superAdminAuthModal`에서 SHA-256 해시 비밀번호 검증을 요구합니다.

---

## 3. 운영 관리자 콘솔 ([src/admin-core.html](file:///d:/Projects/HVAC%20Seminar%202026/10th-HVAC/src/admin-core.html))

상단 9개 운영 탭(사회자 뷰는 별도 창 `mc-qna.html`로 분리)과 주요 기능 요약:

1. **💬 Q&A 관리 (`tabQna`)**: 세션별 질문 조회, 수정, 삭제, CSV/엑셀 다운로드.
2. **👥 출석부 (`tabCheckin`)**: 실시간 출석 현황 통계, 현장 수동 추가, 카테고리 정정(임직원/외부/VIP/하이엠), 중복 삭제/블록(`blocked`), **기념품 수령 처리/취소(`gift_receipts`)**, 순번 마일스톤 설정 및 축하 이벤트.
3. **🎁 이벤트 설정 (`tabDraw`)**: 럭키드로우 경품·등수·인원 구성, 무대 제어 연동, 전체 당첨자 현황표 및 CSV 내보내기.
4. **📝 세미나 관리 (`tabSchedule`)**: 상단 **현재 라이브/대기 세션 요약 바**, 세션별 진행 상태 전환(`upcoming` / `live` / `done`), 발표자료 URL 및 열람 모드(`읽기전용 보안뷰어` / `다운로드`) 제어, 상단 긴급 공지 배너 발송.
5. **💡 퀴즈 문항 (`tabQuiz`)**: 세션별 퀴즈 릴리즈(일괄·개별 오픈/잠금), 배점 정책 설정, 문항 CRUD, **세션별 1·2위 당첨자 실시간 집계·확정(Lock)·수동 지정**, 전체 성적 CSV 내보내기.
6. **📋 서베이 (`tabSurvey`)**: 설문 문항 편집 및 응답 통계·CSV 내보내기(외부 Forms 연동 시 보조 뷰로 유지).
7. **🎮 미니게임 (`tabGames`)**: 점심 게임 **오픈/마감 실시간 토글**(오픈 시 전 참가자 안내 배너 자동 발송 옵션), 블라인드 시점·목표 온도·도전 기회(3회) 설정, 테스트 더미 생성, 종목별 순위표 및 CSV 내보내기.
8. **📢 카카오 공지 (`tabKakao`)**: 일정표 시간과 연동되는 동적 시간대별 공지 프리셋 생성(세션 1~5 퀴즈·Q&A·서베이 URL 포함), 원클릭 클립보드 복사.
9. **⚙️ 외부 연동 설정 (`tabSettings`)**: Firebase DB URL/Room Key 설정, 공식 링크(`DEFAULT_SITE_LINKS`: 오픈채팅, MS Forms 설문/출석, 지도 URL), 테마 컬러 프리셋, 관리자·슈퍼관리자 비밀번호 변경, `site-config.json` 배포 내보내기 및 전체 백업/초기화.
