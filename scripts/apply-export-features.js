const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'admin-core.html');
let content = fs.readFileSync(filePath, 'utf8');

// 1. HTML 마크업 추가 (tabQuiz 내 현황판 위에 세션별 퀴즈 Top 3 카드 삽입)
const targetMarkup = '<!-- 2. 실시간 참석자 퀴즈 제출 현황판 -->';
const newCardMarkup = `<!-- 1-B. 🏆 세션별 퀴즈 Top 3 당첨자 (스타벅스 커피 쿠폰) -->
      <div class="card" style="margin-bottom: 24px; border: 1px solid rgba(243, 196, 72, 0.45); background: linear-gradient(145deg, #131f16, #09130c);">
        <div class="card-header">
          <div>
            <span class="badge" style="background: rgba(243,196,72,0.18); color: #f3c448; border: 1px solid rgba(243,196,72,0.4); font-size: 11px; padding: 3px 8px; border-radius: 999px;">SESSION QUIZ WINNERS</span>
            <h3 class="card-title" style="margin-top: 6px; color: #fff;">☕ 세션별 퀴즈 Top 3 당첨자 (스타벅스 커피 쿠폰)</h3>
            <p class="card-sub">
              각 세션별 퀴즈 최고 득점자 및 최단시간 제출자 1~3위(Top 3)를 자동 집계합니다.<br>
              <span style="color: #4ade80;">✔ 증정 대상: 사전등록 · 초대(VIP) · 하이엠 인원</span> | 
              <span style="color: #f87171;">✖ 자동 제외: 사외 인원(강사/교수/학생) 및 운영진</span> | 
              <span style="color: #f3c448;">⭐ 산정 기준: ① 가장 높은 점수 &gt; ② 가장 빠른 제출 시각</span>
            </p>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="btn-act primary" onclick="exportQuizSessionWinnersCsv()" style="background: #f3c448; color: #040906; font-weight: 800; border-color: #f3c448;">📥 세션별 Top 3 당첨자 CSV 다운로드</button>
            <button class="btn-act" onclick="renderQuizSessionTop3Winners()">🔄 순위 새로고침</button>
          </div>
        </div>
        <div class="quiz-winners-grid" id="quizSessionWinnersGrid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; margin-top: 16px;">
          <!-- JS 동적 렌더링 -->
        </div>
      </div>

      <!-- 2. 실시간 참석자 퀴즈 제출 현황판 -->`;

if (!content.includes('quizSessionWinnersGrid')) {
  if (content.includes(targetMarkup)) {
    content = content.replace(targetMarkup, newCardMarkup);
    console.log('✓ HTML: quizSessionWinnersGrid 카드 추가 완료');
  } else {
    console.error('✗ HTML 타겟 마크업을 찾을 수 없습니다.');
  }
} else {
  console.log('ℹ HTML: quizSessionWinnersGrid가 이미 존재합니다.');
}

// 2. findCheckinAttendeeInfo 헬퍼 함수 및 exportQnaCsv 수정
const qnaRegex = /function\s+exportQnaCsv\s*\(\)\s*\{[\s\S]*?showToast\('📥 Q&A 목록이 CSV 파일로 다운로드되었습니다\.'\);\s*\}/;
const newQnaCode = `// ---------------------------------------------------------
    // 체크인 참석자 정보 교차 매칭 헬퍼 (동명이인 방지 및 실명·순번 역추적)
    // ---------------------------------------------------------
    function findCheckinAttendeeInfo(nameOrAuthor, email) {
      const cleanEmail = String(email || '').trim().toLowerCase().replace('@lge.com', '');
      const rawAuthor = String(nameOrAuthor || '').trim();

      // 1. 이메일 기준 매칭
      if (cleanEmail && checkinList && checkinList.length > 0) {
        const found = checkinList.find(c => {
          const cEmail = String(c.email || '').trim().toLowerCase().replace('@lge.com', '');
          return cEmail && cEmail === cleanEmail;
        });
        if (found) return found;
      }

      // 2. 성명 완전 일치 또는 포함 매칭
      if (rawAuthor && checkinList && checkinList.length > 0) {
        let found = checkinList.find(c => c.name && c.name.trim() === rawAuthor);
        if (found) return found;

        // "홍길동 수석", "홍길동(LG전자)" 등 2~4글자 한글 성명 추출 매칭
        const nameMatch = rawAuthor.match(/[가-힣]{2,4}/);
        if (nameMatch) {
          const cand = nameMatch[0];
          found = checkinList.find(c => c.name && c.name.trim() === cand);
          if (found) return found;
        }

        // 역방향 포함 매칭
        found = checkinList.find(c => c.name && rawAuthor.includes(c.name.trim()));
        if (found) return found;
      }

      // 3. 사전 등록 명부(roster) 기준 보조 매칭
      try {
        const roster = (typeof getRoster === 'function') ? getRoster() : [];
        if (cleanEmail && roster.length > 0) {
          const rf = roster.find(r => {
            const rEmail = String(r.email || '').trim().toLowerCase().replace('@lge.com', '');
            return rEmail && rEmail === cleanEmail;
          });
          if (rf) return { ...rf, seq: null, checkinId: '' };
        }
        if (rawAuthor && roster.length > 0) {
          const rf = roster.find(r => r.name && rawAuthor.includes(r.name.trim()));
          if (rf) return { ...rf, seq: null, checkinId: '' };
        }
      } catch (e) {}

      return null;
    }

    function exportQnaCsv() {
      let csv = '\\uFEFF번호,세션코드,세션명,체크인순번,체크인ID,성명,작성자표시,소속,이메일,공감수,사회자채택,답변완료,작성시간,질문내용\\n';
      qnaList.forEach((q, idx) => {
        const att = findCheckinAttendeeInfo(q.userName || q.author, q.authorEmail || q.email);
        const seqVal = q.checkinSeq || (att ? att.seq : null);
        const seqStr = seqVal ? '#' + seqVal : '-';
        const checkinIdStr = q.checkinId || (att ? att.checkinId : (seqVal ? ('HVAC-' + String(seqVal).padStart(3, '0')) : '-'));
        const nameStr = (q.userName || (att ? att.name : '') || q.author || '참석자').replace(/"/g, '""');
        const authorStr = (q.author || '').replace(/"/g, '""');
        const deptStr = (q.userDept || (att ? (att.dept || att.org) : '') || '-').replace(/"/g, '""');
        const emailStr = (q.authorEmail || q.email || (att ? att.email : '') || '-').replace(/"/g, '""');
        const contentSafe = (q.content || '').replace(/"/g, '""');

        csv += \`\${idx + 1},"\${q.session || ''}","\${q.sessionName || ''}","\${seqStr}","\${checkinIdStr}","\${nameStr}","\${authorStr}","\${deptStr}","\${emailStr}",\${q.likes || 0},"\${q.isStarred ? 'Y' : 'N'}","\${q.isAnswered ? 'Y' : 'N'}","\${q.time || ''}","\${contentSafe}"\\n\`;
      });
      downloadFile(csv, \`HVAC_2026_QnA_Export_\${new Date().toISOString().slice(0, 10)}.csv\`, 'text/csv;charset=utf-8;');
      showToast('📥 Q&A 목록(체크인번호·성명 세트 포함)이 CSV 파일로 다운로드되었습니다.');
    }`;

if (qnaRegex.test(content)) {
  content = content.replace(qnaRegex, newQnaCode);
  console.log('✓ JS: exportQnaCsv 및 findCheckinAttendeeInfo 교체 완료');
} else {
  console.error('✗ JS: exportQnaCsv 정규식 매칭 실패');
}

// 3. exportLuckyDrawCsv 수정
const luckyRegex = /function\s+exportLuckyDrawCsv\s*\(\)\s*\{[\s\S]*?showToast\('📥 럭키드로우 당첨자 명단이 CSV 파일로 다운로드되었습니다\.'\);\s*\}/;
const newLuckyCode = `function exportLuckyDrawCsv() {
      let csv = '\\uFEFF구분,등수및순번,체크인순번,체크인ID,한글성명,소속(조직),이메일,당첨경품,시간,수령상태\\n';
      const drawnTiers = (drawState && drawState.drawnTiers) ? drawState.drawnTiers : {};
      const sortedTiers = getSortedStageTiers();

      sortedTiers.forEach(tier => {
        const tierWinners = drawnTiers[tier.id];
        if (Array.isArray(tierWinners)) {
          tierWinners.forEach((w, idx) => {
            const att = findCheckinAttendeeInfo(w.name, w.email);
            const seqVal = w.seq || (att ? att.seq : null);
            const seqStr = seqVal ? '#' + seqVal : '-';
            const checkinIdStr = w.checkinId || (att ? att.checkinId : (seqVal ? ('HVAC-' + String(seqVal).padStart(3, '0')) : '-'));
            const deptStr = (w.dept || (att ? (att.dept || att.org) : '') || '-').replace(/"/g, '""');
            const nameStr = (w.name || '').replace(/"/g, '""');
            const emailStr = (w.email || (att ? att.email : '') || '').replace(/"/g, '""');
            const prizeStr = (w.prize || tier.prize || '').replace(/"/g, '""');

            csv += \`"클로징 럭키드로우","\${tier.title} (\${idx + 1}번)","\${seqStr}","\${checkinIdStr}","\${nameStr}","\${deptStr}","\${emailStr}","\${prizeStr}","\${w.time || ''}","현장지급"\\n\`;
          });
        }
      });

      const milestoneWinners = checkinList.filter(att => att.isMilestoneWinner || isSeqMilestoneWinner(att.seq));
      milestoneWinners.forEach(w => {
        const m = getMilestoneBySeq(w.seq);
        const prizeName = w.milestonePrize || (m ? m.prize : '순번 경품');
        const isDelivered = !!(drawState && drawState.deliveredMilestones && drawState.deliveredMilestones[w.seq]);
        const seqStr = w.seq ? '#' + w.seq : '-';
        const checkinIdStr = w.checkinId || (w.seq ? ('HVAC-' + String(w.seq).padStart(3, '0')) : '-');
        const deptStr = (w.dept || w.org || '-').replace(/"/g, '""');
        const nameStr = (w.name || '').replace(/"/g, '""');
        const emailStr = (w.email || '').replace(/"/g, '""');

        csv += \`"N번째 순번이벤트","\${w.seq}번째 체크인","\${seqStr}","\${checkinIdStr}","\${nameStr}","\${deptStr}","\${emailStr}","\${prizeName}","\${w.checkinTime || ''}","\${isDelivered ? '수령완료' : '미수령'}"\\n\`;
      });

      downloadFile(csv, \`HVAC_2026_LuckyDraw_Winners_\${new Date().toISOString().slice(0, 10)}.csv\`, 'text/csv;charset=utf-8;');
      showToast('📥 럭키드로우 및 순번이벤트 당첨자 명단(체크인번호·성명 포함)이 CSV 파일로 다운로드되었습니다.');
    }`;

if (luckyRegex.test(content)) {
  content = content.replace(luckyRegex, newLuckyCode);
  console.log('✓ JS: exportLuckyDrawCsv 교체 완료');
} else {
  console.error('✗ JS: exportLuckyDrawCsv 정규식 매칭 실패');
}

// 4. exportQuizSubmissionsCsv 수정 및 퀴즈 세션별 Top 3 로직 추가
const quizSubRegex = /function\s+exportQuizSubmissionsCsv\s*\(\)\s*\{[\s\S]*?showToast\('📥 퀴즈 참가자 성적표가 CSV 파일로 다운로드되었습니다\.'\);\s*\}/;
const newQuizSubCode = `// ---------------------------------------------------------
    // 퀴즈 당첨 자격 검증 (사외 인원 및 운영진 제외)
    // ---------------------------------------------------------
    function isQuizWinnerEligible(att, sub) {
      const email = String((att && att.email) || (sub && sub.email) || '').trim().toLowerCase();
      const cat = String((att && (att.category || att.type)) || (sub && sub.category) || '').trim().toLowerCase();
      const dept = String((att && (att.dept || att.org)) || (sub && sub.dept) || '').trim().toLowerCase();
      const pos = String((att && att.position) || '').trim().toLowerCase();

      // 1. 사외 인원 제외 (강사, 교수, 학생, 사외참석자)
      if (cat.includes('사외') || dept.includes('사외') || pos.includes('강사') || pos.includes('교수') || pos.includes('학생') || cat.includes('외부')) {
        return false;
      }

      // 2. 운영진 제외 (공정성을 위해 모든 당첨 제외)
      if (att && att.isOperator) return false;
      if (cat.includes('운영') || dept.includes('운영') || pos.includes('운영')) return false;
      if (window.HVAC && window.HVAC.isOperatorEmail && window.HVAC.isOperatorEmail(email)) return false;

      // 3. 사전등록, 초대(VIP), 하이엠, 일반 참석자 -> 당첨 대상 (true)
      return true;
    }

    // ---------------------------------------------------------
    // 세션별 퀴즈 Top 3 산정 (1등: 최고 점수 > 2등: 최단 시간 제출)
    // ---------------------------------------------------------
    function getSessionQuizTop3(sessionNum) {
      loadQuizSubmissionsFromStorage();
      let list = Array.isArray(quizSubmissionsMap)
        ? quizSubmissionsMap
        : Object.keys(quizSubmissionsMap).map(k => quizSubmissionsMap[k]).filter(Boolean);

      const targetSNum = Number(sessionNum);
      const candidates = [];

      list.forEach(sub => {
        const att = findCheckinAttendeeInfo(sub.name, sub.email);
        const isEligible = isQuizWinnerEligible(att, sub);
        if (!isEligible) return; // 사외 및 운영진 제외

        // 세션 점수 산출
        let score = 0;
        let answered = 0;
        if (sub.sessionScores && sub.sessionScores[targetSNum] !== undefined) {
          score = Number(sub.sessionScores[targetSNum]) || 0;
          answered = Number(sub.sessionAnswered && sub.sessionAnswered[targetSNum]) || (score > 0 ? 1 : 0);
        } else if (sub.answers) {
          const sessQuestions = (quizConfigList || DEFAULT_QUIZ_CONFIG).filter(q => Number(q.sessionNum) === targetSNum);
          sessQuestions.forEach(q => {
            const st = sub.answers[q.id];
            if (st && st.isDone) {
              answered++;
              score += (Number(st.score) || 0);
            }
          });
        } else {
          const sessQuestions = (quizConfigList || DEFAULT_QUIZ_CONFIG).filter(q => Number(q.sessionNum) === targetSNum);
          if (sessQuestions.length > 0 && Number(sub.score) > 0) {
            score = Math.round((Number(sub.score) / (quizConfigList.length || 11)) * sessQuestions.length * 10) / 10;
            answered = sessQuestions.length;
          }
        }

        if (score <= 0 && answered === 0) return; // 미응시 또는 0점 제외

        // 타임스탬프 계산
        let ts = sub.timestamp || 0;
        if (!ts && sub.updatedAt) {
          try {
            const todayStr = new Date().toISOString().slice(0, 10);
            ts = new Date(\`\${todayStr} \${sub.updatedAt}\`).getTime();
          } catch (e) {
            ts = Date.now();
          }
        }
        if (!ts) ts = 9999999999999;

        const seq = (att && att.seq) || sub.seq || sub.checkinSeq || null;
        const checkinId = (att && att.checkinId) || sub.checkinId || (seq ? ('HVAC-' + String(seq).padStart(3, '0')) : '-');
        const name = (att && att.name) || sub.name || '참석자';
        const dept = (att && (att.dept || att.org)) || sub.dept || '-';
        const category = (att && (att.category || att.type)) || sub.category || '사전등록';
        const email = (att && att.email) || sub.email || '';
        const timeText = sub.updatedAt || (ts && ts < 9999999999999 ? new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-');

        candidates.push({
          seq,
          checkinId,
          name,
          dept,
          category,
          email,
          score,
          answered,
          timestamp: ts,
          timeText
        });
      });

      // 정렬: 1순위: 점수 높은 순 (DESC), 2순위: 제출시각 빠른 순 (ASC), 3순위: 체크인 순번 빠른 순
      candidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        return (a.seq || 9999) - (b.seq || 9999);
      });

      return candidates.slice(0, 3);
    }

    function renderQuizSessionTop3Winners() {
      const container = document.getElementById('quizSessionWinnersGrid');
      if (!container) return;

      const html = QUIZ_SESSION_INFO.map(sess => {
        const top3 = getSessionQuizTop3(sess.num);
        let itemsHtml = '';
        if (top3.length === 0) {
          itemsHtml = '<div style="color: rgba(255,255,255,0.4); font-size: 12.5px; padding: 12px 0; text-align: center;">아직 세션 퀴즈 제출자가 없습니다.</div>';
        } else {
          itemsHtml = top3.map((w, idx) => {
            const medal = idx === 0 ? '🥇 1등' : (idx === 1 ? '🥈 2등' : '🥉 3등');
            const medalColor = idx === 0 ? '#f3c448' : (idx === 1 ? '#cbd5e1' : '#d97706');
            const seqTag = w.seq ? '#' + w.seq : '-';
            const scoreFormatted = (w.score % 1 === 0 ? w.score.toFixed(0) : w.score.toFixed(1));
            return \`
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 6px; border: 1px solid rgba(255,255,255,0.06);">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-weight: 900; font-size: 12px; color: \${medalColor}; width: 44px;">\${medal}</span>
                  <div>
                    <div style="font-weight: 800; font-size: 13.5px; color: #fff;">
                      \${escapeHtml(w.name)}
                      <span style="font-size: 11px; font-weight: 600; color: #4ade80; margin-left: 4px;">(\${seqTag}, \${escapeHtml(w.checkinId)})</span>
                    </div>
                    <div style="font-size: 11.5px; color: rgba(255,255,255,0.55);">
                      \${escapeHtml(w.dept)} · <span style="color: #94a3b8;">\${escapeHtml(w.category)}</span>
                    </div>
                  </div>
                </div>
                <div style="text-align: right;">
                  <div style="font-weight: 900; font-size: 13.5px; color: #f3c448;">\${scoreFormatted}점</div>
                  <div style="font-size: 10.5px; color: rgba(255,255,255,0.45);">\${w.timeText}</div>
                </div>
              </div>
            \`;
          }).join('');
        }

        return \`
          <div class="card" style="background: rgba(18, 30, 22, 0.7); border: 1px solid rgba(243, 196, 72, 0.25); border-radius: 12px; padding: 14px 16px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px;">
              <div>
                <span style="font-size: 10.5px; font-weight: 800; color: #f3c448; letter-spacing: 0.05em;">SESSION \${sess.num}</span>
                <h4 style="margin: 2px 0 0; font-size: 14px; font-weight: 800; color: #fff;">\${escapeHtml(sess.tag)}</h4>
                <div style="font-size: 11.5px; color: rgba(255,255,255,0.6);">\${escapeHtml(sess.speaker)}</div>
              </div>
              <span style="font-size: 11px; background: rgba(243,196,72,0.12); color: #f3c448; border: 1px solid rgba(243,196,72,0.3); padding: 2px 6px; border-radius: 6px; font-weight: 700;">☕ Top 3 쿠폰</span>
            </div>
            <div>
              \${itemsHtml}
            </div>
          </div>
        \`;
      }).join('');

      container.innerHTML = html;
    }

    function exportQuizSessionWinnersCsv() {
      let csv = '\\uFEFF세션번호,세션구분,세션주제및연사,순위,체크인순번,체크인ID,성명,소속(조직),구분,세션점수,제출시각,당첨경품,지급상태\\n';
      QUIZ_SESSION_INFO.forEach(sess => {
        const top3 = getSessionQuizTop3(sess.num);
        if (top3.length === 0) {
          csv += \`"세션 \${sess.num}","\${sess.tag}","\${(sess.title || '').replace(/"/g, '""')} (연사: \${(sess.speaker || '').replace(/"/g, '""')})","-","-","-","(해당 세션 당첨자 없음)","-","-",0,"-","스타벅스 아메리카노 모바일 쿠폰","미지급"\\n\`;
        } else {
          top3.forEach((w, rankIdx) => {
            const seqStr = w.seq ? '#' + w.seq : '-';
            const checkinIdStr = w.checkinId || '-';
            const nameStr = (w.name || '').replace(/"/g, '""');
            const deptStr = (w.dept || '-').replace(/"/g, '""');
            const catStr = (w.category || '사전등록').replace(/"/g, '""');
            const scoreStr = (w.score % 1 === 0 ? w.score.toFixed(0) : w.score.toFixed(1));
            const timeStr = w.timeText || '-';
            csv += \`"세션 \${sess.num}","\${sess.tag}","\${(sess.title || '').replace(/"/g, '""')} (연사: \${(sess.speaker || '').replace(/"/g, '""')})",\${rankIdx + 1},"\${seqStr}","\${checkinIdStr}","\${nameStr}","\${deptStr}","\${catStr}",\${scoreStr},"\${timeStr}","스타벅스 아메리카노 모바일 쿠폰","현장지급/모바일발송"\\n\`;
          });
        }
      });
      downloadFile(csv, \`HVAC_2026_Quiz_Session_Top3_Winners_\${new Date().toISOString().slice(0, 10)}.csv\`, 'text/csv;charset=utf-8;');
      showToast('☕ 세션별 퀴즈 Top 3 당첨자 명단(커피 쿠폰)이 CSV 파일로 다운로드되었습니다.');
    }

    function exportQuizSubmissionsCsv() {
      loadQuizSubmissionsFromStorage();
      let list = Array.isArray(quizSubmissionsMap)
        ? quizSubmissionsMap
        : Object.keys(quizSubmissionsMap).map(k => quizSubmissionsMap[k]).filter(Boolean);

      // 점수 높은 순 > 제출시각 빠른 순 정렬
      list.sort((a, b) => {
        const scA = Number(a.score) || 0;
        const scB = Number(b.score) || 0;
        if (scB !== scA) return scB - scA;
        const tsA = a.timestamp || 9999999999999;
        const tsB = b.timestamp || 9999999999999;
        return tsA - tsB;
      });

      let csv = '\\uFEFF순위,체크인순번,체크인ID,성명,소속(조직),구분,사번/이메일,풀이완료문항수,획득점수,1차만점문항수,재시도정답문항수,전체문항수,최근제출시각,당첨자격\\n';
      list.forEach((s, idx) => {
        const att = findCheckinAttendeeInfo(s.name, s.email);
        const seqVal = s.seq || (att ? att.seq : null);
        const seqStr = seqVal ? '#' + seqVal : '-';
        const checkinIdStr = s.checkinId || (att ? att.checkinId : (seqVal ? ('HVAC-' + String(seqVal).padStart(3, '0')) : '-'));
        const nameStr = (s.name || (att ? att.name : '') || '참석자').replace(/"/g, '""');
        const deptStr = (s.dept || (att ? (att.dept || att.org) : '') || '-').replace(/"/g, '""');
        const catStr = (s.category || (att ? (att.category || att.type) : '') || '사전등록').replace(/"/g, '""');
        const emailStr = (s.empNo || s.email || (att ? att.email : '') || '-').replace(/"/g, '""');
        const isEligible = isQuizWinnerEligible(att, s);
        const eligStr = isEligible ? '당첨 대상' : '제외 (사외/운영)';
        const solvedNum = Number(s.solved || s.answeredCount) || 0;
        const scoreNum = Number(s.score || 0);

        csv += \`\${idx + 1},"\${seqStr}","\${checkinIdStr}","\${nameStr}","\${deptStr}","\${catStr}","\${emailStr}",\${solvedNum},\${scoreNum},\${Number(s.firstTryCount) || 0},\${Number(s.retryCount) || 0},\${quizConfigList.length || 10},"\${s.updatedAt || ''}","\${eligStr}"\\n\`;
      });
      downloadFile(csv, \`HVAC_2026_Quiz_Scores_All_\${new Date().toISOString().slice(0, 10)}.csv\`, 'text/csv;charset=utf-8;');
      showToast('📥 퀴즈 참가자 전체 성적표(순번·체크인ID·성명 포함)가 CSV 파일로 다운로드되었습니다.');
    }`;

if (quizSubRegex.test(content)) {
  content = content.replace(quizSubRegex, newQuizSubCode);
  console.log('✓ JS: exportQuizSubmissionsCsv 및 세션별 Top 3 로직 교체 완료');
} else {
  console.error('✗ JS: exportQuizSubmissionsCsv 정규식 매칭 실패');
}

// 5. exportGamesCsv 수정
const gamesRegex = /function\s+exportGamesCsv\s*\(\)\s*\{[\s\S]*?URL\.revokeObjectURL\(url\);\s*\}/;
const newGamesCode = `function exportGamesCsv() {
      const list = cachedGameSubmissions || [];
      if (!list.length) {
        alert('내보낼 게임 참여 기록이 없습니다.');
        return;
      }

      const cfg = (window.HVAC && window.HVAC.getGameConfig) ? window.HVAC.getGameConfig() : {};
      const targetT = (cfg.tempTarget !== undefined) ? Number(cfg.tempTarget) : 20.0;
      const tStr = \`\${Math.round(targetT)}℃\`;

      let csv = \`\\uFEFF순위,체크인순번,체크인ID,이름,소속,이메일,전화번호뒷자리,10초_1차,10초_2차,10초_3차,10초_Best,10초_오차,\${tStr}_1차,\${tStr}_2차,\${tStr}_3차,\${tStr}_Best,\${tStr}_오차,달성시각\\n\`;
      list.forEach((item, idx) => {
        const att = findCheckinAttendeeInfo(item.name, item.email);
        const seqVal = item.seq || (att ? att.seq : null);
        const seqStr = seqVal ? '#' + seqVal : '-';
        const checkinIdStr = item.checkinId || (att ? att.checkinId : (seqVal ? ('HVAC-' + String(seqVal).padStart(3, '0')) : '-'));
        const nameStr = (item.name || (att ? att.name : '') || '').replace(/"/g, '""');
        const deptStr = (item.dept || (att ? (att.dept || att.org) : '') || '').replace(/"/g, '""');
        const emailStr = (item.email || (att ? att.email : '') || '').replace(/"/g, '""');

        const row = [
          idx + 1,
          \`"\${seqStr}"\`,
          \`"\${checkinIdStr}"\`,
          \`"\${nameStr}"\`,
          \`"\${deptStr}"\`,
          \`"\${emailStr}"\`,
          \`"\${item.phoneLast4 || ''}"\`,
          item.game10s?.tries?.[0]?.time !== undefined ? item.game10s.tries[0].time : '',
          item.game10s?.tries?.[1]?.time !== undefined ? item.game10s.tries[1].time : '',
          item.game10s?.tries?.[2]?.time !== undefined ? item.game10s.tries[2].time : '',
          item.game10s?.bestTime !== undefined ? item.game10s.bestTime : '',
          item.game10s?.bestDiff !== undefined ? item.game10s.bestDiff : '',
          item.game26c?.tries?.[0]?.temp !== undefined ? item.game26c.tries[0].temp : '',
          item.game26c?.tries?.[1]?.temp !== undefined ? item.game26c.tries[1].temp : '',
          item.game26c?.tries?.[2]?.temp !== undefined ? item.game26c.tries[2].temp : '',
          item.game26c?.bestTemp !== undefined ? item.game26c.bestTemp : '',
          item.game26c?.bestDiff !== undefined ? item.game26c.bestDiff : '',
          \`"\${item.updatedAt || ''}"\`
        ];
        csv += row.join(',') + '\\n';
      });

      downloadFile(csv, \`HVAC_2026_Lunch_Minigame_Leaderboard_\${new Date().toISOString().slice(0, 10)}.csv\`, 'text/csv;charset=utf-8;');
      showToast('📥 점심 미니게임 랭킹(체크인번호·성명 세트 포함)이 CSV 파일로 다운로드되었습니다.');
    }`;

if (gamesRegex.test(content)) {
  content = content.replace(gamesRegex, newGamesCode);
  console.log('✓ JS: exportGamesCsv 교체 완료');
} else {
  console.error('✗ JS: exportGamesCsv 정규식 매칭 실패');
}

// 6. exportSurveyCsv 수정
const surveyRegex = /function\s+exportSurveyCsv\s*\(\)\s*\{[\s\S]*?showToast\([\s\S]*?전체 설문 응답자[\s\S]*?\);\s*\}/;
const newSurveyCode = `function exportSurveyCsv() {
      loadSurveyResponsesFromStorage();
      const cfg = (window.HVAC && window.HVAC.getSurveyConfig)
        ? window.HVAC.getSurveyConfig()
        : (window.HVAC && window.HVAC.DEFAULT_SURVEY_CONFIG) || {};

      const allQuestions = [];
      (cfg.pages || []).forEach(p => {
        (p.questions || []).forEach(q => {
          allQuestions.push(q);
        });
      });

      let csv = '\\uFEFF순번,체크인순번,체크인ID,성명,소속(조직),이메일,사번,직급,평균평점,제출일시';
      allQuestions.forEach(q => {
        const cleanLabel = q.label.replace(/"/g, '""');
        csv += \`,"\${cleanLabel}"\`;
      });
      csv += '\\n';

      surveyResponsesList.forEach((s, idx) => {
        const att = findCheckinAttendeeInfo(s.name, s.email);
        const seqVal = s.seq || (att ? att.seq : null);
        const seqStr = seqVal ? '#' + seqVal : '-';
        const checkinIdStr = s.checkinId || (att ? att.checkinId : (seqVal ? ('HVAC-' + String(seqVal).padStart(3, '0')) : '-'));
        const nameStr = (s.name || (att ? att.name : '') || '').replace(/"/g, '""');
        const deptStr = (s.dept || (att ? (att.dept || att.org) : '') || '').replace(/"/g, '""');
        const emailStr = (s.email || (att ? att.email : '') || '').replace(/"/g, '""');
        const answers = s.answers || {};

        csv += \`\${idx + 1},"\${seqStr}","\${checkinIdStr}","\${nameStr}","\${deptStr}","\${emailStr}","\${s.empNo || ''}","\${s.position || ''}",\${s.avgScore || '5.0'},"\${s.submittedAt || ''}"\`;
        allQuestions.forEach(q => {
          const val = answers[q.id] !== undefined ? String(answers[q.id]).replace(/"/g, '""') : '';
          csv += \`,"\${val}"\`;
        });
        csv += '\\n';
      });

      downloadFile(csv, \`HVAC_2026_Survey_Responses_\${new Date().toISOString().slice(0, 10)}.csv\`, 'text/csv;charset=utf-8;');
      showToast('📥 만족도 설문 전 문항 응답 명부(체크인번호·성명 세트 포함)가 CSV 파일로 다운로드되었습니다.');
    }`;

if (surveyRegex.test(content)) {
  content = content.replace(surveyRegex, newSurveyCode);
  console.log('✓ JS: exportSurveyCsv 교체 완료');
} else {
  console.error('✗ JS: exportSurveyCsv 정규식 매칭 실패');
}

// 7. renderQuizTab 및 renderQuizSubmissionsTable에 renderQuizSessionTop3Winners() 호출 추가
if (!content.includes('renderQuizSessionTop3Winners();')) {
  content = content.replace(
    'renderQuizSubmissionsTable();',
    'renderQuizSubmissionsTable();\n      renderQuizSessionTop3Winners();'
  );
  console.log('✓ JS: renderQuizTab 에 renderQuizSessionTop3Winners() 호출 추가 완료');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('🎉 모든 변경사항이 src/admin-core.html 에 성공적으로 기록되었습니다!');
