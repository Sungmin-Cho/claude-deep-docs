# deep-docs

에이전트 지침 문서(CLAUDE.md, AGENTS.md 등)의 신선도를 검증하고 자동 정비하는 가드닝 플러그인.

## Why

> "지침이 너무 많으면 지침이 되지 않는다. 순식간에 망가진다."
> — OpenAI, Harness Engineering

에이전트 지침 문서는 코드 변경에 따라 빠르게 낡아집니다. dead reference, 이동된 경로, 오래된 예시가 쌓이면 에이전트가 잘못된 정보로 작업하게 됩니다.

## Features

- **scan**: 문서와 코드 간 괴리를 자동 탐지 (죽은 참조, 경로 이동, 오래된 예시)
- **garden**: auto-fix 가능 항목을 diff로 보여주고 사용자 확인 후 수정
- **audit**: 문서 품질을 정량 평가 (크기, 신선도, 참조 정확도, 중복도)

## Installation

```bash
claude plugin add deep-docs
```

## Commands

| Command | Description |
|---------|-------------|
| `/deep-docs scan` | 문서 신선도 스캔 |
| `/deep-docs garden` | 자동 정비 (사용자 확인 후) |
| `/deep-docs audit` | 문서 품질 리포트 |
