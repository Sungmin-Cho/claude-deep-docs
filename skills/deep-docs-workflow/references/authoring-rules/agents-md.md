<!-- 출처: developers.openai.com/codex/guides/agents-md, openai/codex (agents_md.rs / config_toml.rs), agents.md (표준) -->

# AGENTS.md Authoring Rules

`doc-author`가 AGENTS.md를 **생성/재구성**할 때 따르는 규칙. 출처는 OpenAI Codex 공식 가이드 + agents.md 표준.

## 길이 — 줄 + 바이트 병행 (비대칭)

- **soft 목표 ≤100줄** — deep-docs의 줄 기반 size-warning 측정과 호환.
- **hard fail = ≤32KiB 누적** (Codex `project_doc_max_bytes`; 루트→리프 concatenate된 누적 바이트). **이것이 유일한 진짜 차단선** — Codex 런타임이 32KiB 초과분을 **잘라** 기능적 손실이 나기 때문.
- **바이트 근사 heuristic**: doc-author는 Bash(`wc -c`)가 없으므로 32KiB를 **줄 수 × 평균 줄 길이로 근사**한다 (영문 ~60B/줄 기준 32KiB ≈ 540줄; 한글/긴 줄은 보수적으로 하향). 정확한 32KiB byte 차단은 **garden이 Write 직전** `draft_body`의 UTF-8 byte를 계산해 강제한다 (doc-author 추정은 soft, multibyte/long-line draft가 heuristic을 빠져나가도 garden에서 포착).
- **줄+바이트 비대칭 명시 (D11/N3)**: authoring은 줄(soft) + 바이트(hard) 둘 다 보지만, **audit의 size-warning은 줄만** 본다. 즉 authoring은 Codex 바이트 예산까지 고려하고, audit은 기존 줄 기반 신호를 유지하는 **v1 의도된 분리**다. (README에도 한 줄 명시 — 사용자 혼동 방지.)

## 관용 섹션 (자유 형식)

```
overview / setup / test / style / structure / PR / security / boundaries
```

## 복사 금지 / 회피

- **README / CLAUDE.md 내용 복사 금지** — Codex는 README / CLAUDE.md를 **자동으로 읽지 않으므로** 복사는 32KiB 바이트 예산만 낭비한다.
- 내부 구분자 문자열 `--- project-doc ---`를 본문에 넣지 말 것 (Codex가 문서 경계 표시에 사용).

## 계층 / override 인지

- `~/.codex/AGENTS.md` (글로벌) + `.git` 루트 ~ CWD walk, root→cwd concatenate (가까운 게 우선).
- `AGENTS.override.md`가 같은 레벨의 `AGENTS.md`를 대체.
- **모노레포 중첩 분산**: 루트 AGENTS.md는 공통만, 패키지별 세부는 하위 AGENTS.md로 분산 (32KiB 누적 예산 관리).

## mode 분기

`claude-md.md`와 동일한 create / restructure 휴리스틱 (재생성 가능 → `removal_candidates`, 그 외 → `preserved_blocks` 보수적 보존).
