# 조각 (Jogak)

기억을 꿰매는 조각보 앨범. 인스타그램의 균일한 격자에 갇힌 사진들을 꺼내, 크기와 이음새가 제각각인 조각보로 다시 꿰맨다. 서버 없이 브라우저 안에서만 동작하며 사진은 밖으로 나가지 않는다.

## 실행

```sh
npm install
npm run dev        # http://localhost:5173/ (데모), /quilt.html, /debug.html
npm test           # 그리드 감지 단위 테스트
npm run fixtures   # 합성 캡처 PNG/PDF 만들기 (fixtures/out)
npm run demo-photos # 데모용 예시 사진 다시 만들기 (public/demo)
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
| `src/color` | k-means 대표 색, 느낌 → 천(모시·삼베·명주) | 2 |
| `src/layout` | 기억의 무게, 불규칙 조각보 분할 | 2 |
| `src/render` | 천 짜기(노이즈), 조각보·솔기 그리기 | 2 |
| `src/quilt` | 2단계 조각보 화면 | 2 |
| `src/interaction` | 바느질 규칙(순서, 땀, 흐트러짐), 드래그·hover·길게 누르기 | 3 |
| `src/render/export.ts`, `src/app` | 창에 걸기(빛 모드), 다 꿰맨 뒤 PNG로 간직하기 | 4 |
| `src/demo`, `public/demo` | 업로드 없이 보는 첫 화면, 교체 가능한 예시 사진 | 4 |

- 1단계 설명과 실패 사례 처리: [docs/stage-1-grid.md](docs/stage-1-grid.md)
- 2단계 메커니즘과 이유: [docs/stage-2-quilt.md](docs/stage-2-quilt.md)
- 3단계 바느질과 원본 비쳐 보기: [docs/stage-3-sewing.md](docs/stage-3-sewing.md)
- 4단계 빛 모드, PNG 내보내기, 데모: [docs/stage-4-light-export-demo.md](docs/stage-4-light-export-demo.md)
