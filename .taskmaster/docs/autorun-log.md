# 자동 작업 기록

(맨 위 요약은 끝낼 때 쓴다)

## 2026-11-25 준비 (16시대, 사용자와 함께)

- 협업 방향 확정: 초대 링크 · 인증 없음 · 호스트 Claude 계정 · 장표 세션 · 보낸 사람 · 담당 없음 · 브라우저 직접 편집 · 의견 (collab-architecture.md)
- collab 작업 17개로 새로 씀 (C0~C5 + 마무리). master 는 최적화 · 심각한 보안만 남김
- 이미 끝난 것: master #26 (담당 파일 덮어쓰기, PR a7garden/claudeppt#3 → 원본 0.7.0)
- 이미 만든 것(옮길 것): fork feat/team-sessions — 담당 제거 · 장표 세션 · 보낸 사람 · 세션 목록 · 새 대화 · 보낼 곳 (0.6.0 기준)

### 목록에서 뺀 작업 (사용자 지시: 방향 · 최적화 · 심각한 보안만)

- master #1 [고장] --resume 실패 시 세션 복구 + 「새 대화」 단추 — collab #3 으로 합침
- master #2 [고장] claude 실행 파일 탐색 보강 — collab #4 로 합침
- master #3 [고장] 앱 종료 시 claude 프로세스 정리 — collab #4 로 합침
- master #4 [고장] 프롬프트 ↔ 내보내기 규칙 맞추기 (글머리 목록이 그림으로 굳음) — 방향 · 최적화 · 보안이 아님
- master #5 [고장] 멈춤이 안 듣는 구간 + 그림 공급자 시간 제한 — 방향 · 최적화 · 보안이 아님
- master #6 [고장] openProject 동시 호출 시 리스너 중복 — collab #6 으로 합침
- master #7 [성능] git 명령 비동기화 + 덱별 잠금 + 호출 수 줄이기 + 전역 설정 격리 — collab #2 로 합침
- master #11 [성능] 핫 리로드 범위 좁히기 + deck:// 캐시 헤더 — collab #9 로 합침
- master #15 [성능] 썸네일을 PNG 캐시로 (동시 iframe 35~40개 줄이기) — collab #9 로 합침
- master #19 [보안] deck:// CSP · .cppt 임시물 제외 · 명령 경로 검증 — collab #7(원격 허용 목록) · #9(CSP) 로 합침
- master #20 [기능] 턴 끝 자동 점검 (넘침 · 그림으로 굳은 글) — 기능 추가
- master #21 [기능] 사용량 표시 (컨텍스트 · 캐시 · 턴 수 · 시간) — 기능 추가
- master #22 [기능] SmartArt 가져오기 — 기능 추가
- master #23 [기능] 턴별 차이 보기 — 기능 추가
- master #24 [문서] README 를 코드에 맞추기 — 문서
- master #25 Claude Code 최소 판 검사 · 기능 감지 — 방향 · 최적화 · 보안이 아님
- master #27 [고장] 쉬는 틈 자동 업데이트가 일하는 중에 다시 켠다 — collab #5 로 합침
- master #28 [고장] 앱 판에 담당 파일이 이름 없이 섞인다 — 담당을 걷어내 해당 없음
- master #29 [고장] 바깥 CLI 판 남기기가 바뀐 파일을 잠금 밖에서 센다 — 담당을 걷어내 해당 없음
- master #30 [성능] activity.jsonl 이 끝없이 커지고 8초마다 통째로 읽힌다 — 담당을 걷어내 해당 없음

## collab #1 — 팀원 세션을 0.7.0 위 collab 줄기로 (18:29 ~ 18:44)

- 브랜치: fork `collab` = 원본 0.7.0(c36069a) + 5커밋 `1ea29f4` 담당 걷기 · `52315f7` 장표 세션 · 보낸 사람 · `dda8da1` 세션 목록 · 새 대화 · 보낼 곳 · `0dbdefc` 0.7.0 맞추기 · `b7b7f7b` 보낼 곳 줄이기 + vcs 시험
- 0.7.0 과 합친 것: 원본이 손본 담당 코드(seats 저장 · wroteAt 등)는 걷음. 첨부(attach)는 살림: 첨부만 있는 요청도 보냄, 턴에 첨부 남김. 보낼 곳을 범위 줄 안 보내기 옆으로(「→ 세션 n」, 까닭은 툴팁). 새 문구에서 긴 대시 걷고 「~습니다」로. 이름 예시 「민지」. PPTX 가져오기 · 내보내기 전 판에도 이름
- **막힌 것**: 원본 최신 두 커밋(9203878 MIT 라이선스 · 이슈/PR 서식, eaf02ce README 다시 씀)에 `.github/workflows/release.yml` 변경이 있어 fork 로 push 가 거절됨(gh 토큰에 workflow 권한 없음, `gh repo sync` 도 같은 까닭). 그래서 collab 을 eaf02ce 가 아닌 c36069a 위에 둠. 사용자가 `gh auth refresh -s workflow` 를 하면 fork main 동기화 → collab 에 upstream/main 합치기. 원본 PR 용 fix/perf 브랜치도 당분간 c36069a 에서 딴다(원본 main 과 문서만 달라 PR 에 지장 없음)
- 시험
  - `npx tsc --noEmit` 통과 · `cargo check` 경고 0 · `cargo test` — 새 vcs 시험 2개 통과(판마다 작성자 · 이름 없음=ClaudePPT · 꺾쇠 빼기 · 빈 이름 · 제목의 탭 · 되돌리기 작성자 · 잠금 파일 남지 않음)
  - 개발 실행 + 가짜 Claude(시험 덱 「제목 없음 2·3」, 끝나고 지움): 은채 · 민수 8요청 라우팅이 기대와 모두 같음 — 첫 요청 s1, 처음 보는 쪽 → 마지막 세션, 새 대화 → s2, 확정된 1쪽 → s1 로 이어 보냄(알림), @ 없이 보는 쪽의 세션, 여러 쪽이면 덱 순서로 첫 확정 쪽. resume 은 세션마다 그 세션의 Claude id. 판 작성자 은채/민수 그대로
  - 화면(스크린샷 `.taskmaster/docs/shots/c1-*.png` 를 보고 확인): 보낼 곳 「→ 세션 2」가 다른 세션이면 진하게(c1-route) · 세션 목록(c1-list) · 세션 누르면 그 세션 턴만 · 새 대화가 빈 대화 + 알림(c1-new) · 이름이 없으면 이름 칸 + 보내기 막힘 + 알림 → 이름 칸 Enter 로 저장 · 첨부만 보내기(턴에 첨부 칸, 프롬프트에 첨부 경로 · 「Request from teammate: 지호」)(c1-attach) · 범위 줄 한 줄 유지(c1-bar) · 판 목록 작성자(c1-vers)
  - 다시 열기: 세션 · 묶음 · 지금 대화 · 턴 그대로. 옛 talk.json(sessionId 하나) → s1 로 옮겨지고 턴이 s1 에
- 확인하지 못한 것: 진짜 Claude 턴(이 작업은 화면 · 라우팅만 바뀌어 가짜로 충분, 앞서 2턴으로 resume 확인함) · 영어 화면 · 좁은 창
- 사용자 덱 「제목 없음」: 건드리지 않음(마지막 판 fffba4c 그대로)

## collab #2 — 오래 걸리는 명령을 화면 스레드 밖으로 (18:44 ~ 18:53)

- 브랜치: `fix/commands-off-main-thread` 0fcfec7 (fork main = 0.7.0 위) → **원본 PR a7garden/claudeppt#4** · collab 에 합침 9320232
- 바꾼 것
  - `vcs_init` · `vcs_commit` · `vcs_log` · `vcs_tag` · `vcs_restore` · `library_list` · `pack_deck` · `unpack_deck` · `abs_read_bytes` · `abs_copy_in` → `#[tauri::command(async)]`. 원본이 담당 명령에 이미 쓰는 방식이고, 함수는 동기 그대로라 CLI 는 손대지 않음
  - 덱 저장소 git 에 `-c core.hooksPath=<없는 폴더>` · `core.fsmonitor=false` · `log.showSignature=false` · `color.ui=false` · `i18n.logOutputEncoding=utf-8`
  - 하지 않은 것: git 호출 수 줄이기(창이 안 멈추면 효과 작고 원본 vcs 와 충돌만 커짐) · GIT_CONFIG_NOSYSTEM(Windows Git 의 core.fscache 를 잃음) · gc.auto=0(느슨한 개체가 계속 쌓임)
- 시험
  - `cargo test --lib` 9개(fix) / 4개(collab) 통과. 새 시험 `user_git_config_does_not_leak_in`: 저장소에 실패하는 pre-commit · commit-msg 훅, showSignature, color.ui=always, fsmonitor 를 켠 채 판 남기기 · 태그 · 목록 · 되돌리기. **격리 줄을 빼면 「blocked」로 실패**하는 것을 확인
  - 개발 실행: 새 시험 덱의 `.git/claudeppt-commit.lock` 을 쥔 채 판 남기기를 부르고 그동안 `fs_exists` 지연을 잼 — **고치기 전 4333ms(잠금 풀 때까지 앱 전체가 멈춤) → 고친 뒤 2~3ms**. 판은 잠금이 풀린 뒤 이어서 남음. fix 브랜치 · collab 둘 다
- 확인하지 못한 것: release 빌드, 덱 수백 개 라이브러리

## collab #3 — 세션 기록 지키기 · 잃으면 요약으로 잇기 (18:53 ~ 19:06)

- 브랜치: collab `9e0707a` (원본 PR 없음: 장표 세션 구조에 묶인 변경. C5 에서 원본에 맞게 나눌지 정한다)
- 바꾼 것
  - 새 세션은 앱이 uuid 를 정해 `--session-id` 로 준다
  - 턴이 끝나면 `~/.claude/projects/<작업 폴더 이름>/<id>.jsonl` 을 덱 `.claudeppt/sessions/<id>.jsonl` 로 복사(.cppt 에 함께 들어감, 판에는 안 듦)
  - `--resume` 전에 이 자리에 기록이 없으면 옛 자리(같은 PC 에서 옮긴 덱) 또는 덱에 남긴 것을 놓는다. 이미 있으면 덮지 않는다
  - 그래도 `No conversation found` 면: 이 세션의 최근 8턴(시킨 사람 · 요청 · 답 · 파일) 요약을 앞에 붙여 새 세션으로 한 번 더, 알림 「세션 n 의 Claude 기록을 찾지 못해…」
  - 작업 폴더 이름 규칙(실측): 영문 · 숫자가 아닌 UTF-16 단위마다 `-` (`문서` → `--`). 200자 넘는 경로는 Claude 가 줄이고 해시를 붙이므로 놓지 않는다(요약 잇기로 넘어감)
- 시험
  - `cargo test --lib` claude 3개: 실측 이름 2개 · 이모지 · id 거르기(`../x` 등) · 남기기/옮긴 덱/다 지운 뒤 되돌리기/더 새것 덮지 않기/이상한 id 로 경로 넘기기 없음
  - **진짜 Claude 2턴**(시험 동안만 sonnet · low, 끝나고 opus · xhigh 로 되돌림): 1턴의 세션 id = 앱이 정한 uuid · 기록 두 곳(40574바이트) → claude 쪽 기록을 지움(다른 PC 흉내) → 2턴(민수) `--resume` 성공, 답 「은채 님이 1쪽 제목 글자를 「세션 복구 시험」으로 바꿔 달라고 요청했습니다」 — 맥락 · 시킨 사람 유지
  - 가짜 Claude: resume 이 `No conversation found` 로 실패 → 요약(은채 · 민수 요청과 답, 고친 파일) 붙여 새 id 로 다시 → 턴 「done」, 오류 없음, 알림, 다음 요청은 새 id 로 resume (`shots/c3-recover.png`)
- 확인하지 못한 것: 실제로 다른 PC 에서 .cppt 를 풀어 잇기(같은 PC 에서 기록을 지워 흉내 냄) · CLAUDE_CONFIG_DIR 을 쓰는 환경

## collab #4 — claude 찾기 보강 · 앱이 꺼지면 claude 도 끄기 (19:06 ~ 19:13)

- 브랜치: `fix/claude-find-and-cleanup` (fork main 위) → **원본 PR a7garden/claudeppt#5** · collab 합침 `0287fb0`
- 바꾼 것
  - claude 를 앱이 쥔 Windows job(`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`)에 넣음 → 창 닫기 · 업데이트 설치 · 강제 종료 · 죽음 어떤 경우든 OS 가 claude 와 자식까지 끔. RunEvent 처리로는 업데이트 설치(앱을 바로 끝냄) · 강제 종료를 못 잡아서 job 으로 감
  - claude 찾기: PATH(where) → `%USERPROFILE%\.local\bin` → npm 전역 → WinGet Links → Scoop shims. 찾은 경로 기억(없어지면 다시 찾음)
  - `windows-sys` 0.61 직접 의존(이미 tauri 가 쓰는 판, 새 다운로드 없음)
- 시험
  - `cargo test --lib`: 새 2개(찾는 자리 · 순서 / job 을 닫으면 cmd→ping 꺼짐) 포함 fix 10개 · collab 9개 통과, 경고 0
  - 개발 실행: 설정 claude 경로를 잠시 가짜 claude(`cmd` → `ping -n 120`)로 바꿔 턴을 띄우고(보낸 뒤 설정은 바로 되돌림) 앱 프로세스를 강제 종료 — **고치기 전: cmd · conhost · PING 살아남음(손으로 끔) / 고친 뒤: 모두 꺼짐**
  - 설정 파일 확인: claude 경로 "" · opus · xhigh · 이름 은채 그대로
- 확인하지 못한 것: 실제 업데이트 설치 흐름(설치 판 필요) · WinGet/Scoop 으로 깐 PC

## collab #5 — 자동 설치가 쓰던 글 · 바깥 세션을 기다리게 (19:13 ~ 19:22)

- 브랜치: `fix/update-waits-for-draft` → **원본 PR a7garden/claudeppt#6** · collab 합침 `9c13988`
- 바꾼 것: 설치를 미룰 까닭을 `holdsUpdate()` 로 — 일(턴 · 막는 일 · 뒤 일) · **보내지 않은 요청 글 · 첨부**(다시 켜면 사라짐, 핀은 덱에 남아 제외) · 바깥 Claude Code **5분**(보내기 전 묻는 기준 OUTSIDE_MS 와 같게, 전에는 2분)
  - 협업 접속자가 있으면 미루기는 C1 서버(#7)를 만들 때 `holdsUpdate` 에 더한다
  - 원본의 담당 presence 는 담당 세션도 CLI 를 거치며 `outside` 를 갱신하므로 따로 보지 않음
- 시험(개발 실행, fix · collab 둘 다): 빈칸 `null` · 요청칸 실제 입력 `draft` · 지움 `null` · 첨부 `draft` · 지움 `null` · 바깥 3분 전 `outside`(전에는 설치됐을 때) · 6분 전 `null` · 턴 도는 중 `work`
  - 시험 함정: 브랜치를 바꾸면 Vite 가 모듈 주소에 `?t=` 를 붙여, `import("/src/lib/x.ts")` 는 앱과 다른 인스턴스가 된다 → `performance` 의 실제 주소로 불러야 함
- 확인하지 못한 것: 설치 판에서 실제 업데이트가 미뤄졌다 설치되는 흐름(개발 실행은 자동 업데이트를 안 함)

## collab #6 · #7 · #8 — 브라우저로 같이 보기 (19:22 ~ 19:35)

- 브랜치: collab `af78d0f`(전송층 · 리스너 한 벌 · 서버 · 같이 보기가 한 커밋으로 합쳐 올라감 — 명령 사슬이 줄끝 차이로 끊겨 첫 커밋이 빠짐, 강제 push 안 함) · `bee1818`
- 구조(설계 그대로): **쓰기는 호스트 한 곳.** 호스트 화면이 상태(덱 · 턴 · 세션 · 판 · 핀)를 바뀐 칸만 30ms 묶어 `collab_publish` → 서버가 모든 브라우저에 WebSocket 으로. 턴은 바뀐 턴만. 새로 붙거나 뒤처지면 통째로. 브라우저의 쓰는 동작은 「의도」(허용 목록: 서버 INTENTS + 호스트 처리기)로 호스트에 넘김 — 처리기는 C3
- 서버 `collab.rs`(axum 0.8): `/_/ws` · `/_/rpc`(읽기 3개뿐) · `/_/deck/…`(deck:// 와 같은 serve, 경로 검사 · 런타임 그대로) · `/__rt.js` · 그 밖은 화면(설치 판은 앱에 담긴 화면, 개발 실행은 Vite 로 넘김). 기본 포트 47815(쓰이면 빈 포트)
- 열쇠: 켤 때 새 토큰. 링크 `?k=` → 쿠키(HttpOnly · SameSite=Lax)로 바꾸고 주소에서 뗌(303). 쿠키 · 토큰 없으면 401. IP 로 믿지 않음
- 화면: 설정 › **협업** 탭(켜기 · 초대 링크 · 복사 · 방화벽 안내 · 접속한 사람) · 제목 줄 「n명 접속」(누르면 누가 몇 쪽) · 쪽 목록 번호 옆 · 무대 오른쪽 위 머리글자(누르면 그 사람이 보는 쪽으로)
- 브라우저에서 감춘 것: 창 단추 · 홈 · 제목 고치기 · 내보내기/릴리즈 · 설정 · 끌어 놓기 · 파일 고르기 · 자동 업데이트. 브라우저 설정(이름 · 말 · 테마)은 그 브라우저 localStorage
- 함께: 팀원이 붙어 있으면 자동 설치를 미룸(holdsUpdate "members") · 호스트 화면을 다시 그려도 켜진 서버에 다시 붙음(resumeHost)
- 시험
  - `cargo test --lib`: collab 3개(열쇠 비교 · 쿠키/쿼리 읽기 · 의도 허용 목록) 포함 통과 · tsc 통과
  - curl(127.0.0.1:47815): 열쇠 없음 401 · 틀린 열쇠 401 · 링크 → 303 + Set-Cookie + Location `/` · 쿠키로 화면 200 · 슬라이드 200 + `<script src="/__rt.js">` · `/__rt.js` 200 · `..%5C..%5CWindows%5Cwin.ini` · `../../../Windows/win.ini` 403 · rpc read 200 · 밖 경로 400 · `write` 400 · log 200
  - **Edge(별도 프로필, 원격 디버깅 9334)로 LAN 주소 `http://10.143.185.36:47815/?k=…` 열기** → 주소에서 열쇠 사라짐 · 덱 보임(`shots/c7-remote1.png`) · 호스트가 쪽 추가 + 1쪽 글 고침 → 브라우저에 바로 반영(`c7-remote2.png`) · 브라우저 이름 「민수」 → 호스트 쪽 목록 · 무대에 「민」(`c7-host.png`) · 호스트 가짜 턴의 글자 흐름 · 세션 1 · 판 v2 가 브라우저에 그대로(`c7-remote-talk.png`) · 설정 협업 탭(`c7-settings.png`)
  - 호스트 화면 새로 고침 → 서버에 다시 붙음, 팀원 목록 유지
- 확인하지 못한 것: 다른 PC(같은 와이파이)에서 — 이 PC 의 LAN 주소로 같은 PC 브라우저에서만 해 봄. Windows 방화벽 허용 창(개발 실행 exe 는 이미 허용됐는지 묻지 않았음) · 설치 판의 화면 내주기(asset_resolver) — 개발 실행은 Vite 길만 탐

## collab #9 — 슬라이드 격리 · 캐시 · 압축 (19:35 ~ 19:40)

- 브랜치: collab `77ccc83`
- **보안(심각)**: 브라우저에서 슬라이드가 앱과 같은 출처라, 슬라이드 안 스크립트가 앱 화면을 조작하거나 그 팀원 이름으로 의도(Claude 요청 등)를 보낼 수 있었다 → 슬라이드 iframe 을 `sandbox="allow-scripts"`(출처 없음)로, 슬라이드는 쿠키 대신 **덱 열쇠 주소** `/_/d/<열쇠>/…`(읽기 전용, 화면 열쇠와 다름)로, 슬라이드 HTML 에 CSP `connect-src 'none'; form-action 'none'; base-uri 'self'; object-src 'none'`
- `/_/ws` · `/_/rpc` 는 Origin 이 Host 와 같을 때만(같은 PC 다른 포트 · sandbox `null` 막기)
- 캐시: 지금 파일 ETag + no-cache(304) · `<id>@<커밋>` 과 설치 판 `/assets/` immutable · gzip
- 시험
  - `cargo test --lib` collab 5개(Origin 검사 6가지 · ETag) 통과
  - 슬라이드 iframe 안에서(Edge CDP 로 그 iframe 에 붙어): `parent.document` SecurityError · `fetch('/_/rpc')` 막힘 · `WebSocket('/_/ws')` 막힘 · `document.cookie` SecurityError
  - curl: 다른 Origin 의 rpc 403 · `Origin: null` 의 ws 403 · 틀린 덱 열쇠 401 · ETag 같으면 304 / 다르면 200 · 판 고정 주소 `immutable` · 런타임 41KB → gzip 14.5KB
  - 화면: 격리해도 슬라이드 · 쪽 목록이 그대로 그려짐(`shots/c9-remote.png`)
- 하지 않은 것: 원격 쪽 목록 PNG 썸네일(지금은 iframe, 캐시로 두 번째부터 가벼움) · 호스트에 깔린 local() 글꼴 내주기(글꼴 라이선스 · 크기 때문에 보류 — 덱 `assets/fonts` 에 든 글꼴은 그대로 감, 다른 PC 에 없는 글꼴은 대체 글꼴로 보임) · 느린 길 첫 화면 시간(설치 판 필요)

## collab #10 — 초대 링크 · 이름 한 번 · 참가자 관리 (19:40 ~ 19:58)

- 브랜치: collab `c073978`
- 바꾼 것
  - 장부 `invite.rs`(앱 데이터 `collab.json`, 덱 · .cppt 에 안 듦): 링크(공용 · 개인 · 만료) · 기기(쿠키 열쇠는 **SHA-256 해시로만**) · 회의 잠금. 링크 열쇠는 호스트가 다음 날 다시 복사할 수 있게 그대로 둠(이 PC 앱 데이터에만)
  - `/j/<열쇠>`: 공용은 이름 화면(한영, Accept-Language) → 기기 쿠키(HttpOnly · Lax · 1년) → `/`. 개인 링크는 정한 이름으로 바로. 만료 · 없는 링크 · 잠금은 까닭을 적은 화면(403)
  - 팀원 이름 = 서버가 기기마다 정한 이름. 의도의 보낸 사람도 이 이름(브라우저가 보낸 이름은 안 씀)
  - 설정 › 협업: 링크 목록(공용/개인 · 복사 · 지우기 · 만료 표시) · 개인 링크 만들기(+만료 없음/하루/7일) · 회의 잠금 · 들어온 사람(접속 중/마지막 때 · 내보내기)
  - 내보내기: 그 자리에서 WebSocket 을 끊고 기기 열쇠를 지움 → 브라우저는 「호스트가 내보냈습니다」, 덱을 걷고 다시 붙지 않음
  - 협업을 끌 때 열린 WebSocket 을 모두 닫음(전에는 브라우저가 옛 서버에 붙은 채 남아 다시 켠 서버에 못 붙었음 — 시험에서 찾음)
  - 하지 않음: 대기실(선택 항목) — 잠금으로 대신
- 시험
  - `cargo test --lib`: invite 5개(공용/개인 · 만료/없음/잠금 · 내보낸 기기 쿠키 무효 · 저장 파일에 열쇠 없음 · 이름 다듬기) 포함 19개 통과
  - curl: 쿠키 없음 401 · 옛 `?k=` 401 · 공용 링크 이름 화면 · 없는 링크 403(영어) · 빈 이름 다시 묻기 · 이름 → 303 + 기기 쿠키 · 쿠키로 화면 200 · 쿠키 있는 채 링크 → `/` · collab.json 에 기기 열쇠 없음(해시만)
  - Edge 프로필 셋: 공용 링크 → 이름 화면(`shots/c10-join.png`) → 「민수」로 들어옴(이름 칸 없음, 이름 고정) · 개인 링크 → 「지호」로 바로 · 잠금 중 새 사람 → 「호스트가 회의를 잠갔습니다」, 민수는 새로 고쳐도 그대로 · 지호 내보내기 → 즉시 「호스트가 내보냈습니다」(`c10-kicked.png`), 새로 고침 401 · 협업 껐다 켜기, 앱 다시 띄우기 뒤 민수 저절로 다시 붙음 · 설정 화면(`c10-settings.png`)
- 확인하지 못한 것: 다른 PC · 휴대폰에서 링크 열기

## collab #11 — 바깥 길 자동 (19:58 ~ 20:04) — **blocked: 도구 없음**

- 브랜치: collab (커밋 「깔린 Tailscale · cloudflared 로 바깥 길을 열어…」)
- 만든 것: `tunnel.rs` — 감지(where + 깐 자리) · Tailscale Funnel(`funnel --bg --https=443 http://127.0.0.1:<포트>`, 주소는 `status --json` 의 DNSName, 끌 때 `--https=443 off`) · cloudflared quick tunnel(`tunnel --no-autoupdate --url …`, 주소는 stderr, 앱 job 에 넣어 앱과 함께 꺼짐). 협업을 켤 때 도구가 있으면 저절로 엶 → 그 주소가 초대 링크 첫 주소 · 제목 줄 「바깥 열림 · n명」. 바깥 주소 Origin 도 같은 출처로 받음. 설정 › 협업 › 바깥에서도(열림/닫힘/도구 없음 안내)
- 시험: `cargo test` tunnel 3개(quick tunnel 줄 읽기 · tailscale 이름 · **가짜 cloudflared(.cmd)로 띄우기 → 주소 읽기 → 끄기 후 프로세스 없음**) · collab Origin(바깥 주소) · 개발 실행: 도구 없음 → 안내 글(`shots/c11-settings.png`), 강제로 열면 「Tailscale 도 cloudflared 도 깔려 있지 않다」
- **막힌 까닭**: 이 PC 에 tailscale · cloudflared 가 없다. 남의 프로그램을 받아 깔고 서버를 인터넷에 여는 일은 사용자 확인 없이 하지 않았다
- 사용자가 할 일: `winget install Cloudflare.cloudflared`(계정 필요 없음) 또는 Tailscale 설치 + 관리 화면에서 Funnel 허락 → 앱에서 협업 켜기 → 휴대폰(LTE)으로 링크 열기 → 대화 글자가 흐르는지(WebSocket 이 터널을 지나는지)

## collab #12 — 브라우저에서 Claude 에게 요청 (20:04 ~ 20:18)

- 브랜치: collab (커밋 「브라우저 팀원이 대화칸에서 Claude 에게 요청하고…」)
- 바꾼 것
  - 호스트 의도 처리기 `send` · `stop` · `newTalk` · `upload`. `send(text, att, force, from)` — from = { by(서버가 정한 이름), 그 팀원이 보던 쪽, 그 팀원의 지금 대화, 핀, onStart }. routeOf 그대로, 호스트가 보는 대화 · 핀은 그대로. 턴이 서면 바로 세션을 돌려줘 브라우저 대화칸이 그리로
  - 브라우저 「새 대화」는 호스트의 지금 대화를 바꾸지 않음
  - 원격 첨부: 붙여 넣기 → 호스트 `.claudeppt/attach/` (그림 · PDF · 글, 10MB). 요청엔 그 경로만 받음
  - **경쟁 상태 고침**: send 가 「도는 중」을 본 뒤 턴을 세우기까지 판 남기기를 기다리는 틈에 다른 요청이 끼어들어 한 세션에 턴 둘이 돌았다 → send 를 문 하나로(`isSending`), 협업 처리기도 봄
  - 세션 id 가 UUID 가 아니면 claude 가 「--resume requires a valid session ID」를 낸다 → 이것도 기록을 잃은 것으로 보고 요약으로 새로 이음
- 시험(Edge 「민수」 · 호스트 「은채」)
  - 가짜 Claude: 브라우저 새 대화 → s2(호스트는 s1 그대로) · 2쪽에 요청 → s2, 2쪽이 s2 에 확정, 판 작성자 민수 · 호스트가 2쪽 「이 쪽 글자를 키워」 → s2 를 잇고 알림 · 턴 도는 중 브라우저 요청 → 「Claude 가 다른 요청을 처리하는 중입니다」 · 원격 첨부 note.txt → 호스트 파일 내용 · 턴 첨부 · 프롬프트 OK, evil.exe 거절 · 동시 두 요청 → claude 한 번만
  - **진짜 Claude(시험 동안만 sonnet · low, 끝나고 opus · xhigh 로 되돌림)**: 브라우저에서 「1쪽 제목 아래 부제」 → 세션 기록이 없어 요약으로 새 세션 → 완료, 1쪽에 부제, 판 v6 작성자 민수(`shots/c12-remote.png`)
  - 시험 중 찾은 것: 개발 중 HMR 로 모듈이 두 벌 올라오면 의도 처리기도 둘이 되어 같은 요청이 두 번 처리됐다(부제가 두 번 들어감) — 개발 전용 현상이지만 그 틈을 막는 경쟁 상태 고침을 넣었다
- 확인하지 못한 것: 다른 PC 브라우저 · 큰 첨부(수 MB) 전송 시간

## 보안 1건 — 원본에 비공개로 알림 (20:20 ~ 20:25)

- #14 를 하다가 슬라이드 쪽 보안 문제 하나를 찾았다(원본 0.7.0 에도 있음, 협업으로 팀원이 슬라이드를 직접 고치면 더 쉽게 닿음). 원본 SECURITY.md 대로 **비공개 보고**(GitHub Security › Report a vulnerability)로 알렸다: `GHSA-9x34-8r55-j5qw`(triage). 고친 판이 나오기 전까지 자세한 내용은 공개 저장소(이 기록 백업 포함)에 적지 않는다 — 사용자에게는 아침 요약에서 따로 알린다
- collab: `56183e1` 「슬라이드 문서가 연결할 수 있는 곳을 자기 덱으로 좁힌다」(CSP). 원본용은 이 PC 의 로컬 브랜치 `security/deck-csp` 에만(올리지 않음)
- 시험: 고친 뒤 막힘 확인 · 슬라이드 그리기 · PPTX 내보내기(글자 뽑기, 그림 굽기 — 구운 그림 글꼴까지 정상) 그대로

## collab #14 — 브라우저 팀원 직접 편집 (20:18 ~ 20:30)

- 브랜치: collab (커밋 「브라우저 팀원도 슬라이드를 직접 고치고…」)
- 바꾼 것: 의도 `direct`(편집 모양 검사) · `undo` · `redo`. 되돌리기 걸음에 `by`(고친 사람) · `after`(고친 직후 글) — 사람마다 제 걸음만, 그 사이 남이 같은 쪽을 고쳤으면 되돌리지 않고 「판 목록에서 되돌릴 수 있습니다」. 직접 편집 판 작성자 = 그동안 고친 사람들. `editing`(쪽마다 마지막 편집자 · 때) → 「○○ 님이 이 쪽을 고치는 중」(8초). 브라우저 되돌리기 단추는 `histBy[내 이름]`
- 시험
  - 원격 `applyDirect` → 호스트 파일 바뀜 · 호스트 무대에 「민수 님이 이 쪽을 고치는 중」(`shots/c14-host-note.png`) · 4초 뒤 판 「민수 직접 편집」
  - **처음엔 민수의 되돌리기가 은채가 그 뒤에 고친 줄까지 지웠다**(파일 통째 되쓰기) → 고침 → 다시 시험: 민수 고침 → 은채 고침 → 민수 되돌리기 거절(알림, 둘 다 남음) → 은채 되돌리기(은채 것만) → 은채 다시 하기 OK · 판 「은채 · 민수 직접 편집」
  - Edge 에서 **실제 마우스 두 번 누르기 → 글 입력 → Enter** → 격리된 슬라이드 안에서 고쳐 호스트 파일에 들어감(`c14-typing.png`)
- 확인하지 못한 것: 원격 끌어 옮기기(patch)는 같은 길(의도 · 검사)이라 코드로만 확인 · 두 사람이 같은 요소를 동시에 고칠 때 화면(나중 것이 남는 것은 파일 쓰기 순서로 보장)

## collab #13 — 세션마다 대기열 · 다른 세션끼리 동시 (20:30 ~ 20:39)

- 브랜치: collab (커밋 「세션마다 요청을 줄 세우고…」)
- 바꾼 것: `runs`(세션 → 도는 턴) · 기다리는 줄 · 동시 상한 3 · 턴 세우기만 한 줄(sendChain), 실행은 세션마다 · 함께 돌 때 끝난 턴의 판엔 그 턴이 고친 파일만(`vcs_commit_paths`, `:(literal)` · 덱 밖 경로 거름) · 턴을 세울 때 가리킨 쪽을 그 세션에 바로 붙임 · 「대기 중 · 취소」 · 멈춤은 지금 대화의 턴 · 브라우저 요청을 바쁘다고 거절하지 않음
- 시험
  - `cargo test --lib` 23개 통과(새 `commit_paths_takes_only_given_files`)
  - 가짜 Claude: s2 느린 턴 + s1 턴 **동시**(runs=s2,s1) · s1 둘째 요청 대기 → 앞 턴 뒤 이어 돎 · 같은 쪽(@2) 요청은 s2 대기열로(미리 붙이기) · 대기 턴 취소 · 판 v4 · v5 · v6 에 각자 쪽 파일 하나씩, 끝나고 남은 변경 없음 · 앞서의 라우팅 시험 결과 그대로 · 화면(`shots/c13-queued.png`)
  - **사고 기록**: 첫 구현에서 async 함수가 돌려준 약속을 JS 가 풀어 「턴 세우기」 줄이 턴이 끝날 때까지 막혔고, 시험 스크립트가 오류로 끝나며 가짜 Claude 를 먼저 되돌려 남은 시험 요청 셋이 **진짜 Claude(opus)로 몇 초씩** 돌았다 → 바로 멈춤. 고친 뒤 시험 스크립트는 모든 턴이 끝날 때까지 가짜를 되돌리지 않게 함
- 확인하지 못한 것: 진짜 Claude 두 세션 동시(사용량 때문에 가짜로만) · 동시 턴이 deck.json 을 함께 고칠 때(쪽 더하기 등) — 미리 붙이기로 같은 쪽은 막지만 덱 구성 파일은 마지막 쓴 것이 남는다

## collab #15 — 공유 의견 (20:39 ~ 20:44)

- 브랜치: collab (커밋 「핀을 작성자 · 해결 상태가 있는 의견으로…」)
- 바꾼 것: 핀에 `by`(꽂은 사람) · `done`(해결). 요청칸 위 초안 · 보내기는 내 열린 핀만 · 남의 의견은 무대에 읽기 전용(해결 · 세션에 보내기) · 대화 머리 「의견 n」 목록(해결됨 · 다시 열기) · 새 의견 알림 · 「세션에 보내기」= 「○○ 님이 남긴 의견을 반영해 줘」를 그 쪽 세션에, 프롬프트 핀 줄에 `(comment by ○○)` · 브라우저는 제 핀만 고치고 지움 · CLI `pins` 는 해결된 것 빼고 `by` 함께
- 시험(가짜 Claude, 호스트 은채 · 브라우저 민수): 서로 의견 → 서로 알림(「민수 님이 1쪽에 의견을 남겼습니다」) · 요청칸 위엔 각자 제 것만 · 「의견 2」 · 민수가 은채 의견을 세션에 보내기 → 턴 보낸 사람 민수, 프롬프트 `(comment by 은채)` · 은채가 민수 의견 해결 → 무대 · 쪽 목록 점에서 사라짐, pins.json `done: true`, 「해결됨 1」(`shots/c15-list.png`) · 바깥 CLI `pins` 가 해결된 것을 빼고 `by` 를 줌
- 처음엔 의견 목록 창이 사이드바 오른쪽 밖으로 잘렸고 쪽 목록 점이 해결된 의견도 셌다 → 고침

## collab #16 — 원본 기여 준비 (20:44 ~ 23:16)

- 이슈 #1 관리자 답 아직 없음 → **협업 PR 은 보내지 않음**(사용자 확인 뒤). `.taskmaster/docs/upstream-plan.md` 에: 보낸 것(PR #3~#7 · 비공개 보고) · 원본에도 이로운 작은 후보 · 협업 11개 PR 순서와 커밋 · 스위치 여부 · CHANGELOG 줄(안) · 보내기 전 손볼 것(담당 결정, 스위치 감싸기, workflow 권한)
- 문구 점검: 협업 줄기의 새 화면 글에 긴 대시 0 · 한영 키 349개 일치 · 안내문은 「~습니다」(남은 6개는 상태 · 자리표시 · Claude 에게 가는 요청문)
- 작은 수정 **원본 PR #7** 「대화 · 폴더 사건 리스너를 앱에 한 벌만 붙인다」 — 개발 실행에서 같은 덱을 겹쳐 열고 claude 사건 한 줄 → 답에 한 번만
- (20:44 ~ 23:14 사이 세션이 한동안 멈춰 있었다 — 자동 작업 예약 신호가 여러 번 쌓여 들어옴)

## collab #17 — 1차 시험 결과 · 내일 시험 안내서 (23:14 ~ 23:25)

- `.taskmaster/docs/test-guide.md` 를 씀: 만든 것과 브랜치 · 띄우는 법 · 이미 확인한 것 · 직접 해 볼 시험(A 이 PC 한 대 · B 같은 와이파이의 다른 PC/휴대폰 · C 바깥 — 도구 설치) 단계와 기대 결과 · 알려진 한계 · 보안 1건
- 더 확인: **release 빌드**(`npx tauri build --no-bundle`, 6분 53초)로 띄워 협업을 켜고 Edge 로 붙음 → 앱에 담긴 화면(`/assets/index-sXG8EMJ4.js`)이 내려오고 슬라이드 · 대화 · 접속 표시 정상(`shots/c17-release.png`), 장부가 이어져 민수가 링크 없이 다시 들어옴, `index` no-cache · `/assets` immutable · gzip 862KB → 282KB. 시험 기기는 내보냄, 앱은 끔
- 확인하지 못한 것: 설치 파일(nsis)로 깐 앱

## master #18 — image-size 취약점 (23:25 ~ 23:28)

- 브랜치: `fix/image-size-audit` → **원본 PR a7garden/claudeppt#8** · collab 합침
- `npm audit` high 1건: pptxgenjs 3.12 가 받는 image-size 1.x(JXL · HEIF · ICNS 무한 루프). 1.x 에는 고친 판이 없어 `overrides` 로 2.x(2.1.0). 잠금 파일은 image-size 와 그것이 쓰던 queue 만 바뀜
- 따져 보니 pptxgenjs 의 브라우저 번들은 image-size 를 쓰지 않는다(Node 전용) → 앱에서는 닿지 않던 경로. 그래도 의존성 검사를 깨끗하게
- 시험: `npm audit` 0 · `npm run build` 통과 · 빌드 번들에 image-size 없음 · 개발 실행에서 PPTX 내보내기(글자 뽑기 53KB · 그림 굽기 251KB) 그대로
- Rust: `cargo audit` 이 없어 새로 더한 크레이트(axum 0.8 · tower-http 0.6 · sha2 0.10 · windows-sys 0.61)가 최신 판인 것만 확인

## master #8 — 스트리밍 답 묶기 · 다시 그리기 줄이기 (23:28 ~ 23:32)

- 브랜치: `perf/stream-batch` → **원본 PR a7garden/claudeppt#9** · collab 에도 같은 변경
- 바꾼 것: 글자 조각을 30ms 모아 한 번에(다른 사건 앞 · 턴이 끝날 때 먼저 비움, 창이 가려져도 돌게 타이머) · TurnView memo(판 열기를 안으로) · 쪽 목록은 마지막 턴의 도구 목록만 구독
- 잰 것(도는 턴에 claude 사건으로 조각 300개, 개발 실행): 상태 갱신 **300 → 18~21번** · 대화 DOM 변경 301 → 19~22번 · 메인 스레드 막힘 **227~426ms → 32~39ms** · 다 받기까지 1.5~1.7초 → 0.6~0.7초
- 기능 확인: 「글자 · 글자 · 새 덩이 · 글자 · 끝」 → 답 `첫 덩이\n\n둘째` 그대로 · 턴의 판 단추 → 판 보기 열림
- 하지 않은 것: Rust 쪽 사건 묶기(Channel) — 화면 쪽 묶기로 충분해 넣지 않음 · 경계 끌기 때 memo(효과 작음)
