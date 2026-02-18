# 진행 기록

Original prompt: "재밌는 아이디어가 생각났어. 기본은 테트리스... 멀티보드 ... 죽으면 바로 자동 진행"  
요청 내용:
1) 사용자 조작 없이 AI가 판을 진행
2) 죽음 페널티 없음, 즉시 자동 재시작
3) 난이도 점진 상승
4) AI 스킬(배치/회전/속도/멀티보드 라우팅)으로 성장
5) 멀티보드(최소 2개)로 분할 착지

Implemented:
- `index.html`, `styles.css`, `script.js`로 동작형 MVP 완성
- AI 배치 점수 계산 + 후보 탐색 + 라우팅
- 보드 재시작은 재화/레벨에 영향 없이 즉시 리셋
- 스킬 업그레이드 버튼(코인 소비)으로 난이도에 따른 성장치 반영
- 난이도(stage/level)와 중력 자동 상승
- 2번째 보드 자동 오픈 조건 추가(총 라인/난이도/라우팅 스킬 기반)
- `window.render_game_to_text`, `window.advanceTime` 노출

TODO:
- 라인 클리어 점수/보상 수치 조정 필요(게임 템포 최적화)
- 회전 스킬의 회전 실험성 로직(현재는 간단한 회전 + 킥 허용) 미세 보강
- 보드 높이/좌우 여유 등 시각 레이아웃 반응형 보정 추가 가능

- Death reset behavior updated:
  - ���̵��� `runLines` �������� ���.
  - ���� ���� �� stage/level/gravity�� 1/�⺻���� ���µ�.
  - ��ų/��ȭ/����/�� ���� ������ ����.
- QA: fixed bottom-gap artifact risk by tying canvas height to actual board area in resize(). (styles.css height:auto, script.js:813-826 dynamic target height).
- UI: restored board summary draw call in script.js:725 (was expression-only).

