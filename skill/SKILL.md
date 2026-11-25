---
name: claudeppt
description: ClaudePPT 앱의 발표 덱(HTML 슬라이드 → 편집 가능한 PPTX)을 앱 밖 Claude Code 에서 만들고 고친다. 덱 목록 · 새 덱 · PPTX 가져오기 · 슬라이드 HTML 고치기 · 쪽 더하기 · 빼기 · 옮기기 · 사용자가 앱에서 꽂은 핀 의견대로 고치기 · 쪽 그림으로 확인 · PPTX 로 나갈 모양 점검 · 판(버전) 남기기와 되돌리기 · PPTX 내보내기 · 릴리즈를 CLI 로 한다. 「ClaudePPT」 「발표 자료 만들어」 「슬라이드 고쳐」 「핀대로 고쳐」 「덱」 「PPTX 로 내보내」 요청, 또는 /claudeppt 로 부른다.
---

# ClaudePPT — 앱 밖에서 덱 다루기

ClaudePPT 는 발표 덱을 **HTML 파일 폴더**로 짓고, 다 되면 편집 가능한 PPTX 로 내보내는 데스크톱 앱이다.
앱 안에 Claude 대화칸이 있지만, 이 스킬은 **이 세션이 직접** 덱 파일을 고치고 CLI 로 앱을 부린다.
앱이 켜져 있으면 고친 파일이 앱 화면에 바로 다시 그려진다 — 사용자는 앱으로 보고, 너는 파일을 고친다.

## CLI

```bash
CPPT=~/.claude/skills/claudeppt/cppt     # 앱 실행 파일을 찾아 부르는 꾸러미
$CPPT help
```

출력은 늘 JSON 하나다 — `{"ok":true,"data":…,"deck":"<쓴 덱 폴더>"}` 또는 `{"ok":false,"error":"…"}` (종료 코드 1). 쪽 번호는 1부터 센다 (deck.json 의 slides 순서).

**덱은 명령마다 `--deck "<덱 폴더 절대경로>"` 로 정한다.** 폴더 대신 저장 폴더 안 폴더 이름 · 덱 제목도 받는다.
`cd` 에 기대지 않는다 — 이 세션의 Bash 는 작업 폴더 밖으로 간 `cd` 를 다음 호출에서 되돌리고, 그러면 `--deck` 없는 명령은 **앱에 열린 다른 덱**을 쓴다.
덱을 바꾸는 명령(`commit` · `restore` · `add` · `remove` · `move` · `gen` · `release` · `pins --done`)은 `--deck` 이 없으면 앱에 열린 덱으로 넘겨짚지 않고 거절한다. 출력의 `deck` 으로 어느 덱을 썼는지 늘 확인한다.

| 명령 | 하는 일 | 앱 |
| - | - | - |
| `status [--wait]` | 앱이 켜졌는지 · 열린 덱 · 지금 쪽 · **앱 안 Claude 가 일하는 중인지(`running`)**. `--wait` 는 끝날 때까지 기다린다 (기본 600초 · `--timeout <초>`) | 켜져 있을 때만 |
| `list` | 저장 폴더의 덱 (최근 고친 순) | 필요 없음 |
| `info` | 목차(쪽 번호 · id · 파일 · 제목) · 지금 판 · 릴리즈 · **남은 핀 수(`pins`)** | 필요 없음 |
| `log [-n 20]` | 판 이력 | 필요 없음 |
| `commit -m "<한 줄>"` | 바뀐 파일을 한 판으로 남긴다 | 필요 없음 |
| `restore <v3 \| 3 \| 커밋>` | 그 판으로 되돌려 새 판으로 남긴다 (이력은 지우지 않는다) | 필요 없음 |
| `add [--at <n>] [--title <제목>] [--copy <k>]` | 빈 쪽(또는 k쪽 사본)을 n번째 자리에 더한다 (기본 맨 끝) — 새 파일의 `path` 를 돌려준다 | 필요 없음 |
| `remove <n>` | n쪽을 목차에서 뺀다 (파일은 남는다) | 필요 없음 |
| `move <n> --to <m>` | n쪽을 m번째 자리로 옮긴다 | 필요 없음 |
| `pack <out.cppt>` · `unpack <file.cppt>` | 폴더째 한 파일로 묶기 · 풀기 (판 이력 포함) | 필요 없음 |
| `new <제목> [--template <이름>] [--no-open]` | 저장 폴더에 새 덱 (표지 한 장) — `dir` 과 템플릿의 스타일 규칙 `style` 을 돌려준다 | 띄운다 |
| `import <file.pptx> [--no-open]` | PPTX 를 가져와 새 덱으로 | 띄운다 |
| `style` | **이 덱이 따를 스타일 규칙과 그림 규칙** — 앱 안 Claude 가 받는 것과 같은 글. 가져온 덱이면 「원본 모양 유지」 | 띄운다 |
| `pins [--slides 1,3] [--no-marks]` | 사용자가 앱에서 쪽에 꽂은 **핀 의견** — 번호 `n` · 쪽 · 좌표 · 가리킨 요소 · 그어 놓은 표시. `text` 는 읽기 좋은 한 덩이, `marks` 는 표시를 빨갛게 그려 넣은 쪽 그림 PNG 경로 | 띄운다 |
| `pins --done <1,3 \| all>` | 다 고친 핀을 지운다 (`n` 은 `pins` 가 준 번호) | 띄운다 |
| `gen` | `<img data-gen="…">` 그림 자리를 앱 설정의 그림 생성 방식으로 채운다 (`filled` · `errors`) | 띄운다 |
| `open [--slide 3]` | 덱을 앱 화면에 열고 그 쪽으로 간다 | 띄운다 |
| `shot [--slides 1,3-5] [--scale 1] [--out <폴더>]` | 쪽을 브라우저가 그린 그대로 PNG 로 (기본 `.claudeppt/shots/<n>.png`) | 띄운다 |
| `inspect [--slides …]` | PPTX 로 나갈 때 그림으로 굳는 것(`baked`) · 쪽 밖으로 넘친 것(`overflow`) | 띄운다 |
| `export <out.pptx> [--exact]` | PPTX 로 내보낸다. `--exact` 는 모양 그대로(그림 + 투명 글상자, 편집 불가) | 띄운다 |
| `check` | PPTX 를 PowerPoint 로 그려 웹과 픽셀로 견준다 (PowerPoint 필요) · 쪽마다 차이 % 와 web/ppt/diff 그림 경로 · 그림으로 굳은 요소(`locked`)와 그 넓이 %(`stiff`) | 띄운다 |
| `release [--name …] [--notes …]` | 릴리즈 r<k> — `releases/r<k>-v<n>.pptx` + git 태그 | 띄운다 |

「띄운다」 명령은 앱이 꺼져 있으면 앱을 띄우고 준비될 때까지 기다린다 (처음 몇 초). 덱을 다루는 명령으로 띄웠으면 그 덱을 화면에 연다.
덱을 쓴 명령은 켜진 앱에 「앱 밖에서 이 덱을 다루는 중」이라고 알린다 — 앱은 그 뒤 5분 동안 그 덱에서 앱 안 Claude 에게 보내기 전에 사용자에게 한 번 묻는다.

## 작업 순서

1. **덱을 고른다** — `list` 로 찾거나 `new "<제목>"` · `import <pptx>`. 돌려받은 `dir` 을 이후 모든 명령의 `--deck` 에 쓴다.
2. **`status` 로 `running` 을 본다.** `true` 이고 같은 덱이면 앱 안 Claude 가 같은 파일을 고치는 중이다 — 사용자에게 알리고 `status --wait` 로 끝날 때까지 기다린다.
3. **`style` 로 이 덱의 스타일 규칙을 받아 모든 쪽에 지킨다.** `info` 로 목차를 보고, 필요한 `slides/*.html` · `theme.css` · `deck.json` 을 읽는다. 가져온 덱이면 `source/pages/<n>.png`(원본 쪽 그림)도 본다.
4. **`info` 의 `pins` 가 0 이 아니면 `pins` 로 읽는다.** 사용자가 「핀대로 고쳐」 「표시한 데 고쳐」라고 하면 이것이 요청이다.
   `marks` 그림을 Read 로 먼저 본다 — 좌표 글만으로는 어디를 가리키는지 잘못 짚기 쉽다. 그다음 핀마다 고친다.
5. 파일을 고친다 (아래 「파일 꼴」 「PPTX 로 잘 나가게」). 쪽을 더하고 빼고 옮기는 것은 `add` · `remove` · `move` 로 한다.
6. **눈으로 확인한다** — `shot --slides <고친 쪽>` 뒤 PNG 를 Read 로 본다. 글이 넘치거나 겹치면 다시 고친다.
   사용자가 앱으로 보고 있으면 `open --slide <n>` 으로 고친 쪽을 띄워 준다.
7. **PPTX 모양을 점검한다** — `inspect --slides <고친 쪽>`. `overflow` 는 고친다. `baked` 의 `whole` 이 `img` · `svg` 가 아니면(변형 · 필터 등으로 통째 그림이 됨) 편집 가능하게 바꿀 수 있는지 본다.
8. 그림 자리(`data-gen`)를 넣었으면 `gen` 으로 채우고 다시 `shot` 으로 본다.
9. **한 묶음의 요청을 마치면 `commit -m "<무엇을 했는지 한 줄>"`** (예: `"3쪽 표 정리"`) — 앱의 판 목록(v<n>)에 한 판으로 남는다. 판은 앞으로만 쌓이니 자주 남겨도 된다.
   핀을 처리했으면 `pins --done <고친 번호>` 로 지운다 — 남겨 두면 사용자가 앱 안 Claude 에게 보낼 때 같은 핀이 다시 간다.
10. 사용자가 원하면 `export <경로>.pptx` 또는 `release`.

## 파일 꼴 (claudeppt/1)

```
<덱 폴더>/
  deck.json          제목 · 크기 · 쪽 순서 ("slides" 배열이 쪽 순서의 유일한 정본)
  theme.css          모든 쪽이 함께 쓰는 서식 — CSS 변수 --ink --paper --accent --muted --line --soft --radius --stroke --font 와 .slide 틀
  slides/<id>.html   한 쪽에 한 파일. ../theme.css 를 잇고 <section class="slide"> 하나 (기본 1280×720px)
  assets/            그림 · 글꼴. 쪽에서는 "../assets/<이름>"
  source/            가져온 원본 — original.pptx · pages/<n>.png
  releases/          릴리즈 PPTX · releases.json            ← 손대지 않는다
  .claudeppt/        앱 상태(대화 · 핀 · 쪽 그림 · 검사)      ← 손대지 않는다 (shots/ · attach/ 는 읽기만)
  .git/              판 이력                                ← 손대지 않는다. git 대신 CLI 의 commit · restore
```

- **쪽 더하기**: `slides/<id>.html` 을 새로 쓰고(id = "s" + 영소문자·숫자 6자) deck.json 의 `slides` 알맞은 자리에 `{"id","file","title"}` 를 넣는다.
- **쪽 빼기**: deck.json 에서 항목만 뺀다 (파일은 둔다 — 지난 판 보기가 읽는다). **순서 바꾸기**: 배열 순서를 바꾼다.
- `title` 은 짧게 — 앱의 쪽 목록에 보인다.
- 새 쪽 HTML 꼴:

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="../theme.css">
</head>
<body>
<section class="slide">
	…
</section>
</body>
</html>
```

- 오프라인 전용 — 바깥 URL · CDN · 웹 글꼴 · `<script>` 를 넣지 않는다.
- 색 · 글꼴 · 모서리는 theme.css 변수로만 쓴다. 되풀이되는 모양은 theme.css 에 작은 class 로 둔다.

## PPTX 로 잘 나가게

내보내기는 브라우저가 그린 DOM 을 재서 PowerPoint 로 다시 짓는다.

| 웹에서 | PPTX 에서 |
| - | - |
| 단색 바탕 · 고른 테두리 · 둥근 모서리 · 한 변 선 | 편집 가능한 도형 · 선 |
| 자식이 인라인(span · b · strong · em · br)뿐인 블록의 글 | 편집 가능한 글상자 — **맨 글과 블록 자식을 섞지 않는다** |
| `<table>` | 표 |
| `<img>` · 인라인 `<svg>` | 그림 (그림 · 아이콘 · 차트는 SVG 로) |
| 그라데이션 · 바탕 그림 · 그림자 · `::before/::after` · 고르지 않은 모서리/테두리 · 목록 표식 | 바탕만 그림으로 굳고 그 위 글자는 편집 가능 |
| transform/회전 · filter · blend · clip-path · text-shadow | **자식째** 그림으로 굳는다 (글자 편집 불가) |

- 납작한 색 · 실선 · 글머리는 `<span>` 으로 — 그래야 글이 편집 가능하게 남는다.
- PowerPoint 는 이 PC 에 깔린 글꼴만 쓴다 — `var(--font)` 를 쓰고 다른 글꼴을 들이지 않는다.
- flex/grid 또는 `.slide` 안 절대 위치로 놓는다. 1280×720 밖으로 넘치거나 스크롤이 생기면 안 된다.
- 글: 한 쪽에 한 메시지. 짧고 구체적으로. 위계는 상자가 아니라 크기 · 굵기로. 여백 64px 이상.

## 함정

- `{"ok":false,"error":"…명령 받기」가 꺼져 있다…"}` — 사용자가 앱의 「설정 › Claude Code 연결」에서 「명령 받기」를 껐다. 다시 켜 달라고 말한다 (`list` · `info` · `log` · `commit` 처럼 앱 없이 되는 명령은 그대로 된다).
- 앱 안 Claude 가 도는 중(`status.running`)에는 같은 덱을 고치지 않는다 — 그 턴이 끝날 때 판으로 묶이면서 섞인다. `commit` · `restore` · `add` · `remove` · `move` · `gen` 은 이때 스스로 거절한다 (`--force` 는 사용자가 원할 때만).
- `"덱을 바꾸는 명령은 --deck 으로 덱을 정한다…"` — `--deck` 을 빠뜨렸다. 오류에 적힌 「지금 앱에 열린 덱」이 고치던 덱이라고 넘겨짚지 말고, 고치던 덱 폴더를 `--deck` 으로 다시 준다.
- 그림 자리 꼴(`<img data-gen=… data-gen-size=…>`)과 쓸 수 있는지는 `style` 의 그림 규칙에 있다. 그림 생성 방식이 SVG 면 `gen` 은 거절한다 — 그림은 인라인 SVG 로 그린다.
- 핀은 `.claudeppt/pins.json` 을 직접 고치지 않는다 — 앱이 그 덱을 열어 두었으면 앱이 쥔 목록으로 덮어쓴다. `pins --done` 을 쓴다.
- 판(v<n>)은 git 커밋 수다. `git` 을 직접 부르지 말고 CLI 의 `commit` · `restore` 를 쓴다 — 앱의 판 목록이 함께 새로 고쳐진다.
- `export` · `shot` 의 경로에 Git Bash 꼴(`/d/…`)을 줘도 된다. 경로에 빈칸 · 한글이 있으면 따옴표로 감싼다.
- `shot` 그림은 `.claudeppt/shots/` 에 덮어쓴다 — 판에 들어가지 않는다.
- `check` 는 PowerPoint 가 있어야 하고 쪽마다 몇 초 걸린다. 평소 확인은 `shot` + `inspect` 로 충분하다.
