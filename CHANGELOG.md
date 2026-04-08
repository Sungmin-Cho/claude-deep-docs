# Changelog

## [1.0.0] - 2026-04-08

### Added
- `/deep-docs scan` — 죽은 참조, 경로 이동, 오래된 예시, 중복 탐지
- `/deep-docs garden` — auto-fix 가능 항목 수정 (사용자 확인 후)
- `/deep-docs audit` — 문서 품질 정량 리포트 (path-scoped 신선도)
- doc-scanner 에이전트

### Changed
- Rule 3 (오래된 예시): auto-fix → 조건부 auto-fix (CLI/환경변수만 auto-fix, 코드 예시는 audit-only)
- Rule 4 (중복 지침): auto-fix → 조건부 auto-fix (완전 동일 블록만 auto-fix, 유사 블록은 audit-only)
