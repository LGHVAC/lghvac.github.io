# 2026 HVAC Engineering Expert Seminar (제10회) 프로젝트 기술·운영 문서 모음

본 폴더는 차기 유사 세미나 웹 애플리케이션 구축 및 현장 운영의 기반(Blueprint)으로 활용할 수 있도록 프로젝트 전체 구성과 구현된 모든 기능을 영역별로 정리한 문서 모음입니다.

## 문서 목록

1. **[01. 전체 시스템 아키텍처 및 페이지/파일 구성](./HVAC2026_01_architecture_and_pages_261117_0942.md)**
   - 정적 호스팅(GitHub Pages) + Firebase RTDB 하이브리드 구조, 파일/디렉터리 맵, 페이지별 `pageId` 역할·트래픽 전략, 공통 코어 인프라(`hvac-core.js`, DRM 보안 뷰어, 카카오톡 탈출)
2. **[02. Firebase Realtime Database 스키마, 동시성 제어 및 트래픽 최적화](./HVAC2026_02_realtime_db_and_sync_261117_0942.md)**
   - 전체 RTDB 데이터 트리(`meta`, `config`, `checkins`, `gift_receipts`, `quiz`, `games`, `qna`), 보안 규칙(`database.rules.json`), 200명 동시 접속 ETag 트랜잭션 및 다운로드 사용량 최적화 설계
3. **[03. 주요 기능 명세 및 세미나 운영 비즈니스 로직](./HVAC2026_03_features_and_operations_261117_0942.md)**
   - 체크인·Q&A·세션별 퀴즈(차등 배점/중복 제외/확정 Lock)·점심 미니게임(블라인드/3회 제한/동점 처리)·럭키드로우(`hashString53`+Mulberry32+Fisher-Yates)·관리자 콘솔 9개 탭 상세
4. **[04. 차기 세미나 재활용 및 빌드·배포 운영 가이드](./HVAC2026_04_reuse_and_deployment_guide_261117_0942.md)**
   - 신규 행사 복제 체크리스트, 관리자 AES-256-GCM 번들 암호화 빌드(`build-admin.js`), 캐시 버스팅 배포 절차, 개인정보 보호 `.gitignore`, 행사 당일 운영 런북
