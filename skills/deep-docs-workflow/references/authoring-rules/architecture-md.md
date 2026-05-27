<!-- 출처: matklad.github.io/2021/02/06/ARCHITECTURE.md.html (권위 표준) -->

# ARCHITECTURE.md Authoring Rules

`doc-author`가 ARCHITECTURE.md를 **생성/재구성**할 때 따르는 규칙. 출처는 matklad의 권위 있는 ARCHITECTURE.md 표준.

## 목적

메인테이너의 **정신적 지도**. "어디를 고칠지" 찾는 비용을 10배 절감한다. 가끔 기여하는 사람을 대상으로 한다 (코드를 매일 보지 않는 사람).

## 적용 임계값 / 길이

- **~10k LOC+** 규모에서만 생성 후보 (그 이하는 코드가 곧 지도).
- **길이 100~300줄**. 과동기화하지 말고 연 2회 정도 검토.

## 5섹션 골격

```
Bird's-eye overview → Codemap → Architectural invariants → Layer boundaries → Cross-cutting concerns
```

- **Bird's-eye overview**: 시스템이 무엇을 하는지 한 문단.
- **Codemap** = "국가 지도" — **모듈 역할을 1~2문장**으로 (파일 목록 아님). 각 최상위 모듈/디렉터리가 무슨 책임을 지는지.
- **Architectural invariants**: 특히 **부정형**으로 ("X는 Y에 의존하면 **안 된다**"). 깨지면 안 되는 규칙.
- **Layer boundaries**: 레이어 간 허용/금지 의존 방향.
- **Cross-cutting concerns**: 로깅 / 에러처리 / 설정 등 여러 모듈을 가로지르는 관심사.

## 직접 파일/라인 링크 금지

직접 파일 경로/라인 번호 링크는 **금지**한다 ("links go stale" — 링크가 금방 낡는다). 대신 **심볼 이름**으로 검색을 유도한다 (예: "`AuthMiddleware`를 검색"). 이는 deep-docs의 dead-reference / stale-example 철학과 정합한다.

## mode 분기

- **create**: 코드 분석(최상위 모듈/레이어/진입점/의존)을 국가 지도 수준으로 정리해 5섹션 골격으로 작성.
- **restructure**: 기존 문서의 고유 콘텐츠(설계 의사결정/invariant 근거)는 `preserved_blocks`로 보존, 단순 모듈 나열 등 재생성 가능한 부분은 `removal_candidates`로 분류.
