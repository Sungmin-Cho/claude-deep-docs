# Changelog

## [1.0.0] - 2026-04-08

### Added
- `/deep-docs scan` — 죽은 참조, 경로 이동, 오래된 예시, 중복 탐지
- `/deep-docs garden` — auto-fix 가능 항목 수정 (사용자 확인 후)
- `/deep-docs audit` — 문서 품질 정량 리포트 (path-scoped 신선도)
- doc-scanner 에이전트

### Changed
- Rule 3 (Stale Examples): Changed to conditional auto-fix — CLI/env vars only, code examples are audit-only
- Rule 4 (Duplicated Instructions): Changed to conditional auto-fix — 100% identical blocks only
- Scan artifact (.deep-docs/last-scan.json) now includes provenance (HEAD SHA, branch) for safe reuse

### Fixed
- Added explicit scan steps for Rules 5-8 (size, rule-code contradiction, coverage gap, map-vs-manual) in doc-scanner agent
- Added non-git environment branch in doc-scanner (skip git-dependent steps)
- Added full path to scan-rules.md reference in agent
- Excluded node_modules/, vendor/, dist/, build/, __pycache__/ from scan scope
- Added zero-document fallback with clear message
