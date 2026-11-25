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
