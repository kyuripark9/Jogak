# 조각 (Jogak)

기억을 꿰매는 조각보 앨범. 인스타그램의 균일한 격자에 갇힌 사진들을 꺼내, 크기와 이음새가 제각각인 조각보로 다시 꿰맨다. 서버 없이 브라우저 안에서만 동작하며 사진은 밖으로 나가지 않는다.

## 실행

```sh
npm install
npm run dev        # http://localhost:5173/debug.html
npm test           # 그리드 감지 단위 테스트
npm run fixtures   # 합성 캡처 PNG/PDF 만들기 (fixtures/out)
npm run e2e        # 브라우저에서 파일 올려 확인
npm run build      # dist/ 정적 사이트
```

## 구조

| 모듈 | 하는 일 | 단계 |
|---|---|---|
| `src/input` | 스크린샷·긴 캡처·PDF를 띠 단위로 읽는 입력 파이프라인 | 1 |
| `src/grid` | 여백선 감지, 줄 분류, 칸 자르기, 캡처 이어 붙이기 (DOM 없음) | 1 |
| `src/synth` | 검증용 가짜 인스타 프로필 캡처 | 1 |
| `src/debug` | 1단계 확인 화면 | 1 |
| 색·질감 추출, 레이아웃, 렌더링, 인터랙션 | | 2~4 |

1단계 설명과 실패 사례 처리: [docs/stage-1-grid.md](docs/stage-1-grid.md)
