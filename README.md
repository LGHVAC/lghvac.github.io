# 2026 제10회 HVAC Engineering 전문가 세미나 웹사이트 (Smart Edition)

약 200명이 참석하는 엔지니어링 세미나를 위한 공식 안내 및 스마트 인터랙션 웹사이트입니다.  
GitHub Pages를 통해 별도의 서버 구축 비용 없이 안정적으로 무료 호스팅되며, 실시간 아젠다 공지, 연사 프로필, 장소 동선 안내, 카카오톡 오픈 톡방 소통, 스마트 QR 출석체크 및 세션별 퀴즈를 지원합니다.

- **공식 웹사이트:** [https://lghvac.github.io/](https://lghvac.github.io/)
- **저장소 주소:** [https://github.com/LGHVAC/lghvac.github.io](https://github.com/LGHVAC/lghvac.github.io)

---

## 🚀 스마트 기능 (New Features)

1. **💬 카카오톡 오픈 톡방 연계 및 바이럴 공유**: 
   - 실시간 Q&A, 당일 긴급 공지(식당, 발표자료), 참석자 간 네트워킹
   - 1-Click 웹사이트 링크 복사 및 모바일 카카오톡 공유 기능
2. **📱 스마트 3-in-1 QR 안내판 (`qr/index.html`)**:
   - 현장 테이블 및 접수대 비치용 A4 1장 출력 지원
   - 카톡 오픈톡방 입장 QR + 모바일 간편 출석체크 QR + 세미나 웹사이트/퀴즈 QR
3. **💡 세션별 인터랙티브 퀴즈 (Quiz Arena)**:
   - 6개 전문 강연별 핵심 퀴즈 및 즉시 정답/해설 피드백
   - 실시간 점수 누적 및 만찬 럭키드로우 경품 응모 연계

---

## 📂 프로젝트 구조

```text
├── index.html                               # [메인] 세미나 공식 웹페이지 (일정표, 강사, 카톡 소통, 세션 퀴즈, 오시는 길)
├── qr/
│   └── index.html                           # [현장 운영용] A4 3-in-1 QR코드 인쇄 페이지
├── admin_guide_smart_features_261014_0013.md# [운영 매뉴얼] 카카오톡 오픈톡방 & 세션 퀴즈 운영 가이드
├── admin_guide_261014_0001.md               # [기본 매뉴얼] 세미나 일반 운영 및 배포 매뉴얼
├── admin_guide_general_template_261013_2355.md # [템플릿] 타 프로젝트 참고용 범용 매뉴얼
└── README.md
```