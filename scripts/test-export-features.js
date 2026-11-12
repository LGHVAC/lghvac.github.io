const fs = require('fs');
const path = require('path');
const vm = require('vm');

const adminCorePath = path.join(__dirname, '..', 'src', 'admin-core.html');
const html = fs.readFileSync(adminCorePath, 'utf8');

// 가상 브라우저 환경 설정
const createMockEl = () => ({
  value: '',
  textContent: '',
  innerHTML: '',
  options: [],
  style: {},
  classList: { add: () => {}, remove: () => {}, toggle: () => {} },
  appendChild: () => {},
  setAttribute: () => {},
  getAttribute: () => '',
  querySelector: () => createMockEl(),
  querySelectorAll: () => []
});

const sandbox = {
  console: console,
  setTimeout: () => 1,
  clearTimeout: () => {},
  setInterval: () => 1,
  clearInterval: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  document: {
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelectorAll: () => [],
    querySelector: () => createMockEl(),
    getElementById: (id) => createMockEl(),
    createElement: (tag) => createMockEl()
  },
  location: { origin: 'https://lghvac.app', pathname: '/admin.html', search: '' },
  window: {
    addEventListener: () => {},
    removeEventListener: () => {}
  },
  URL: {
    createObjectURL: () => 'blob:mock',
    revokeObjectURL: () => {}
  },
  Blob: function(parts, opts) {
    this.content = parts.join('');
    this.type = opts ? opts.type : '';
  },
  showToast: (msg) => console.log('[Toast]', msg),
  alert: (msg) => console.log('[Alert]', msg),
  escapeHtml: (s) => String(s || ''),
  localStorage: {
    _data: {},
    getItem: function(k) { return this._data[k] || null; },
    setItem: function(k, v) { this._data[k] = String(v); },
    removeItem: function(k) { delete this._data[k]; }
  }
};
sandbox.window = sandbox;

// <script> 추출하여 sandbox 컨텍스트에서 실행
const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let match;
let fullCode = '';
while ((match = scriptRegex.exec(html)) !== null) {
  fullCode += match[1] + '\n';
}

const context = vm.createContext(sandbox);
vm.runInContext(fullCode, context);

console.log('\n--- 1. checkinList 및 샘플 데이터 준비 ---');
const sampleCheckinList = [
  { seq: 1, checkinId: 'HVAC-001', name: '이순신', email: 'sunshin.lee@lge.com', dept: '칠러선행연구팀', org: '칠러선행연구팀', category: '사전등록', isOperator: false },
  { seq: 2, checkinId: 'HVAC-002', name: '홍길동', email: 'gildong.hong@lge.com', dept: '시스템엔지니어링', org: '시스템엔지니어링', category: '사전등록', isOperator: false },
  { seq: 3, checkinId: 'HVAC-003', name: '여명석', email: 'yeo@snu.ac.kr', dept: '서울대학교', org: '건축학과', category: '사외', position: '교수', isOperator: false },
  { seq: 4, checkinId: 'HVAC-004', name: '관리자', email: 'admin@lge.com', dept: '운영기획실', org: '운영기획실', category: '운영진', isOperator: true },
  { seq: 5, checkinId: 'HVAC-005', name: '강감찬', email: 'gamchan@him.co.kr', dept: '하이엠솔루텍', org: '유지보수팀', category: '하이엠', isOperator: false },
  { seq: 6, checkinId: 'HVAC-006', name: '유관순', email: 'gwansun.yu@lge.com', dept: '스마트제어연구', org: '스마트제어연구', category: '초대', isOperator: false }
];
vm.runInContext('checkinList = ' + JSON.stringify(sampleCheckinList) + ';', context);

console.log('\n--- 2. findCheckinAttendeeInfo 매칭 검증 ---');
const match1 = context.findCheckinAttendeeInfo('홍길동 수석', 'gildong.hong@lge.com');
console.log('이메일 + 닉네임 매칭 결과:', match1 ? `${match1.name} (Seq: #${match1.seq}, ID: ${match1.checkinId})` : '실패');
if (!match1 || match1.name !== '홍길동' || match1.seq !== 2) throw new Error('매칭 실패: match1');

const match2 = context.findCheckinAttendeeInfo('이순신', '');
console.log('성명 단독 매칭 결과:', match2 ? `${match2.name} (Seq: #${match2.seq})` : '실패');
if (!match2 || match2.name !== '이순신') throw new Error('매칭 실패: match2');

console.log('\n--- 3. Q&A Export CSV 컬럼 검증 ---');
const sampleQnaList = [
  {
    session: 'k1',
    sessionName: 'Keynote 1 · 주거난방',
    author: '홍길동 수석 (시스템)',
    content: '바닥 복사난방 열전달 효율 최적화 질문입니다.',
    likes: 8,
    isStarred: true,
    isAnswered: false,
    time: '오전 09:50'
  }
];
vm.runInContext('qnaList = ' + JSON.stringify(sampleQnaList) + ';', context);

let capturedCsv = '';
vm.runInContext(`
  downloadFile = (content, filename) => {
    window.__capturedCsv = content;
    console.log('[Download Hook]', filename, 'bytes:', content.length);
  };
`, context);

vm.runInContext('exportQnaCsv();', context);
capturedCsv = vm.runInContext('window.__capturedCsv;', context);
console.log('Q&A CSV 헤더 및 첫 행:');
const qnaRows = capturedCsv.split('\n');
console.log('Line 0:', qnaRows[0]);
console.log('Line 1:', qnaRows[1]);

if (!qnaRows[0].includes('체크인순번') || !qnaRows[0].includes('체크인ID') || !qnaRows[0].includes('성명')) {
  throw new Error('Q&A CSV 헤더에 체크인순번/체크인ID/성명 미포함');
}
if (!qnaRows[1].includes('#2') || !qnaRows[1].includes('HVAC-002') || !qnaRows[1].includes('홍길동')) {
  throw new Error('Q&A CSV 데이터 행에 교차 매칭 결과 미반영');
}

console.log('\n--- 4. 당첨 자격 검증 (isQuizWinnerEligible) ---');
const testSubmissions = [
  { name: '여명석', email: 'yeo@snu.ac.kr', category: '사외' },
  { name: '관리자', email: 'admin@lge.com', category: '운영진' },
  { name: '이순신', email: 'sunshin.lee@lge.com', category: '사전등록' },
  { name: '강감찬', email: 'gamchan@him.co.kr', category: '하이엠' },
  { name: '유관순', email: 'gwansun.yu@lge.com', category: '초대' }
];

testSubmissions.forEach(sub => {
  const att = context.findCheckinAttendeeInfo(sub.name, sub.email);
  const eligible = context.isQuizWinnerEligible(att, sub);
  console.log(`[자격 테스트] ${sub.name} (${sub.category}) -> 당첨 대상 여부: ${eligible ? '✅ 적격' : '❌ 제외'}`);
  if (sub.category === '사외' && eligible) throw new Error('사외 인원이 당첨 대상에 포함됨');
  if (sub.category === '운영진' && eligible) throw new Error('운영진이 당첨 대상에 포함됨');
  if (['사전등록', '하이엠', '초대'].includes(sub.category) && !eligible) throw new Error(`${sub.category} 인원이 부당 제외됨`);
});

console.log('\n--- 5. 세션별 퀴즈 Top 3 산출 및 순위 정렬 검증 (점수 높은 순 > 제출 빠른 순) ---');
// Keynote 1 (세션 1)에 4명이 제출한 상황 시뮬레이션
const sampleQuizMap = {
  user1: {
    name: '이순신',
    email: 'sunshin.lee@lge.com',
    seq: 1,
    checkinId: 'HVAC-001',
    sessionScores: { 1: 2.0 },
    timestamp: 1000,
    updatedAt: '오전 10:00:01'
  },
  user2: {
    name: '홍길동',
    email: 'gildong.hong@lge.com',
    seq: 2,
    checkinId: 'HVAC-002',
    sessionScores: { 1: 2.0 },
    timestamp: 2000, // 이순신보다 1초 늦게 제출
    updatedAt: '오전 10:00:02'
  },
  user3: {
    name: '여명석',
    email: 'yeo@snu.ac.kr', // 사외 강사 -> 제외되어야 함
    sessionScores: { 1: 2.0 },
    timestamp: 500,
    updatedAt: '오전 09:59:59'
  },
  user4: {
    name: '강감찬',
    email: 'gamchan@him.co.kr',
    seq: 5,
    checkinId: 'HVAC-005',
    sessionScores: { 1: 1.5 },
    timestamp: 1500,
    updatedAt: '오전 10:00:01'
  },
  user5: {
    name: '유관순',
    email: 'gwansun.yu@lge.com',
    seq: 6,
    checkinId: 'HVAC-006',
    sessionScores: { 1: 1.0 },
    timestamp: 800,
    updatedAt: '오전 09:59:58'
  }
};
vm.runInContext('localStorage.setItem("hvac_quiz_submissions", JSON.stringify(' + JSON.stringify(sampleQuizMap) + '));', context);
vm.runInContext('quizSubmissionsMap = ' + JSON.stringify(sampleQuizMap) + ';', context);

const top3 = vm.runInContext('getSessionQuizTop3(1);', context);
console.log('세션 1 Top 3 산출 결과:');
top3.forEach((w, idx) => {
  console.log(`  ${idx + 1}위: ${w.name} (#${w.seq}, ${w.checkinId}) - 점수: ${w.score}점, 시각: ${w.timeText}`);
});

if (top3.length !== 3) throw new Error('Top 3 길이가 3이 아님: ' + top3.length);
if (top3[0].name !== '이순신') throw new Error('1위가 이순신이 아님 (동점 시 제출 빠른 이순신이어야 함)');
if (top3[1].name !== '홍길동') throw new Error('2위가 홍길동이 아님');
if (top3[2].name !== '강감찬') throw new Error('3위가 강감찬이 아님 (1.5점)');
if (top3.some(w => w.name === '여명석')) throw new Error('사외 인원인 여명석 교수가 Top 3에 포함됨');

console.log('\n--- 6. 세션별 Top 3 당첨자 CSV 다운로드 검증 ---');
vm.runInContext('exportQuizSessionWinnersCsv();', context);
capturedCsv = vm.runInContext('window.__capturedCsv;', context);
const winnerRows = capturedCsv.split('\n');
console.log('Line 0:', winnerRows[0]);
console.log('Line 1:', winnerRows[1]);
console.log('Line 2:', winnerRows[2]);
console.log('Line 3:', winnerRows[3]);

if (!capturedCsv.includes('스타벅스 아메리카노 모바일 쿠폰')) throw new Error('커피 쿠폰 명칭 미포함');
if (!capturedCsv.includes('이순신') || !capturedCsv.includes('HVAC-001')) throw new Error('1위 당첨자 정보 누락');

console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! 100% VALIDATED!');
