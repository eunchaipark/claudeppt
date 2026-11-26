# 자동 작업 규칙 (사용자가 묻지 말고 하라고 한 작업)

2026-11-25 사용자 지시: 18:30 부터 Task Master 작업을 **하나씩 끝까지, 묻지 말고** 한다. 협업 먼저(`collab`), 그다음 최적화 · 보안(`master`).
사용자는 다음 날 직접 시험한다 — 그 전에 **내가 할 수 있는 1차 시험을 전부** 하고 기록한다.
문맥이 요약돼 기억이 흐려지면 이 파일과 `.taskmaster/docs/autorun-log.md` 를 먼저 다시 읽고 이어 간다.

## 순서

1. `task-master next --tag collab` 이 주는 작업을 의존 순서대로 #1 → #17.
2. collab 이 끝나거나 남은 것이 모두 blocked 면 `task-master next`(master) — high 먼저.
3. 둘 다 없으면 끝내기(아래).
4. 08:30 이 지나면 하던 작업을 커밋할 수 있는 데까지 마무리하고 끝내기.

## 작업 하나의 흐름

1. `task-master set-status --id=<n> --status=in-progress [--tag collab]`
2. `git fetch upstream` — 원본 main 이 앞서갔으면 collab 브랜치에 합치고(충돌은 원본 동작을 살리며 손으로) 기록한다.
3. 작업 details · 이 문서 · `collab-architecture.md` 를 읽고, **지금 코드(0.7.x)에서 위치를 다시 확인**한 뒤 만든다.
4. **시험 — 할 수 있는 것은 전부** (아래 「시험」). 통과할 때까지 고친다.
5. 커밋(아래 「커밋 · 브랜치」) → fork 에 push.
6. `task-master set-status --id=<n> --status=done`, 작업 details 끝에 `[완료 <시각>] 브랜치 · 커밋 · 시험 요약` 을 덧붙인다(tasks.json 직접 수정 — 번호가 문자열일 수 있으니 String(id) 로 찾는다).
7. `autorun-log.md` 에 한 구획: 작업 · 브랜치/커밋 · 한 시험과 결과 · 스크린샷 경로 · **확인하지 못한 것**.
8. 백업: Task Master 파일을 `plan/collab` 브랜치에 올린다 — 이 PC 는 `.git/info/exclude` 로 무시 중이라 worktree 에서 `git add -f`:
   `git worktree add <scratchpad>/plan-wt plan/collab` → `.taskmaster` 복사 → `git -C … add -f .taskmaster` → commit → push → `git worktree remove --force`.

## 시험 (1차 — 사용자 시험 전에 내가 전부)

- 매번: `npx tsc --noEmit`, `cargo check`(경고 0), 바꾼 Rust 에는 `cargo test` 시험을 더한다(새 판정 · 합치기 · 라우팅 · 허용 목록 · 토큰 등).
- 화면이 바뀌면: 개발 실행(`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`, PATH 에 `~/.cargo/bin` · `~/.local/bin`)을 띄우고 `node tools/cdp.mjs` 로 실제 조작 → `shot` 으로 찍어 **반드시 그림을 보고** 확인한다.
- 원격(브라우저) 기능: 협업 서버를 켜고 같은 PC 에서 브라우저 탭(CDP `Target.createTarget` 또는 Edge/Chrome 실행)으로 링크를 열어 호스트 ↔ 브라우저를 오가며 확인. 서버 길은 `curl` 로도.
- Claude 턴: `window.__app.api.claudeRun` 을 가짜로 바꿔 시험한다(`.taskmaster/docs` 앞선 시험 방식). 진짜 Claude 는 꼭 필요할 때 작업당 2턴 이하.
- 시험 덱: 새로 만든 「제목 없음 N」 같은 시험 덱만 쓰고 끝나면 앱에서 닫고 지운다. **사용자의 덱 「제목 없음」은 건드리지 않는다.** 설정(「내 이름」 등)을 바꿨으면 되돌린다.
- 시험이 끝나면 개발 실행 프로세스를 끈다(1424 · 9333 포트가 비었는지).

## 커밋 · 브랜치

- 협업 기능: fork 브랜치 `collab`(원본 0.7.0 위, collab #1 에서 만듦)에 쌓는다. **원본 PR 은 보내지 않는다**(사용자가 다음 날 확인 뒤). C5 에서 나눌 브랜치만 준비.
- 원본에도 이로운 작은 고장 수정 · 최적화 · 보안(collab #2 · #4, master 작업들): `upstream/main` 에서 `fix/<짧은이름>` 또는 `perf/<짧은이름>` 브랜치를 따서 커밋 하나 → fork push → **원본 PR 을 보낸다**(사용자 기본 승인: 작은 수정은 PR 까지) → 같은 커밋을 collab 에도 합친다.
- 원본 PR 규칙(관리자, 이슈 #1): PR 하나에 한 가지 · 판 번호(package.json · Cargo.toml · tauri.conf.json) 올리지 않음 · 설명에 CHANGELOG 한두 줄 · 화면 문구는 i18n 한영 함께, **긴 대시(—) 없이**, 안내문은 「~습니다」 · 원본 담당 기능은 원본 PR 에서는 지우지 않는다(지우는 것은 관리자 답 뒤).
- 커밋 메시지: 원본 꼴(한국어, 「~한다」), 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. PR 설명 끝에 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. `@이름` 멘션 금지.
- 하지 않는 것: 원본에 직접 push, 공유 브랜치 force push, git 전역 설정 바꾸기, Task Master 파일을 기능 브랜치에 커밋, 사용자 데이터 삭제.

## 막히면

- 사용자 결정이 필요하거나(예: 담당 처리), 밖의 것이 없어서 못 하면(예: tailscale · cloudflared 가 안 깔림) → 할 수 있는 데까지 하고 `--status=blocked`, details 에 까닭 · 남은 일, 기록에 남기고 **다음 작업으로**.
- 시험이 계속 실패하면 커밋하지 않은 채로 두지 말고 `wip/<작업>` 브랜치에 올리고 blocked.

## 이 PC 의 함정 (겪은 것)

- Git Bash 의 `sed -i` 는 CRLF 파일을 LF 로 바꾼다 — 소스 편집은 Edit 도구나 node 로. 작업 폴더는 CRLF, 저장소(blob)는 LF(autocrlf=true)라 커밋에는 영향 없음.
- Bash heredoc 은 역슬래시를 한 겹 먹는다 — 역슬래시가 든 코드는 Write/Edit 도구로.
- `grep -c $'\r'` 은 CR 을 제대로 세지 못한다 — node 로 센다.
- 개발 실행 중 Rust 를 고치면 tauri dev 가 다시 빌드하며 앱을 다시 띄운다. 웹뷰에 고치기 전 모듈이 남을 수 있으니 시험 전에 `location.reload()`.
- `task-master set-status` 는 그 태그의 id 를 문자열로 바꿔 저장한다.

## 끝내기

1. collab #17 의 `test-guide.md`(내일 사용자 시험 안내)가 있어야 한다.
2. `autorun-log.md` 맨 위에 요약: 끝낸 작업 · 보낸 PR · blocked 와 까닭 · 사용자가 먼저 볼 것.
3. 백업 push, 개발 실행 끄기.
4. `PushNotification` 한 번(무엇이 끝났고 무엇을 봐야 하는지, 200자 안).
5. 자동 작업 예약(CronDelete)을 지운다.

## 자동 작업 중 알게 된 제약 (2026-11-25 18:45)

- (풀림 2026-11-26 09:55 — 토큰에 workflow 권한이 생겨 fork main = 원본 eaf02ce, collab 에 합침. 새 fix/perf 브랜치는 원본 main 에서 딴다) fork 에 push 할 때 원본의 `.github/workflows/*` 변경이 든 커밋이 섞이면 거절된다(gh 토큰에 workflow 권한 없음 — `gh auth refresh -s workflow` 는 사용자가 브라우저로 해야 함). 원본 9203878 이 그 커밋이다.
  → collab 과 fix/perf 브랜치는 **fork 의 main(= 원본 0.7.0, c36069a)** 에서 딴다. 원본 PR 은 그대로 a7garden/claudeppt main 으로 (원본 main 과 문서만 달라 PR 에 지장 없음). 사용자가 권한을 주면 fork main 을 동기화하고 collab 에 upstream/main 을 합친다.
- 개발 실행에서 모듈을 직접 불러 시험할 때: 브랜치를 바꾸면 Vite 가 import 주소에 `?t=` 를 붙여 `import("/src/lib/x.ts")` 가 앱과 **다른 인스턴스**가 된다. `performance.getEntriesByType("resource")` 에서 `x.ts?t=` 주소를 찾아 불러온다.
- `TaskStop` 은 tauri dev 의 자식(앱 · cargo · vite)을 끄지 못한다 — `scratchpad/dev-stop.ps1` 로 끈다.
