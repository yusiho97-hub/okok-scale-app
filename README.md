# 01_okok_scale_app — 나만의 스마트 체중계 앱 (OKOK 호환 PWA)

## 무엇을 만드는지
- 기존 OKOK International 체중계 앱의 핵심·유료 기능을 광고와 구독 없이 사용할 수 있도록 직접 만든 모바일 설치형 웹 앱(PWA)입니다.
- 대상 기기: 갤럭시 S25 플러스 (안드로이드 Chrome 홈 화면에 앱으로 설치)
- 배포 방식: GitHub Pages (`https://` 주소로 폰에서 바로 열기)

## 파일 위치
- 메인 화면: `index.html`
- 스타일: `styles.css`
- 앱 동작(저장·그래프·리포트·CSV): `app.js`
- 블루투스(BLE) 연결 및 신호 해석: `ble.js`
- 체성분 계산 공식(BMI·체지방·근육량 등): `bia.js`
- 앱 설치 설정(PWA): `manifest.json`, `sw.js`, `icons/`

## 지금까지 한 것
- 앱 4개 탭 구성 확정 (측정하기, 신체 분석 리포트, 변화 그래프·기록, 내 정보)
- 프로젝트 폴더 및 README 생성
- PWA 앱 파일 작성 (`index.html`, `styles.css`, `app.js`, `ble.js`, `bia.js`, `manifest.json`, `sw.js`, 아이콘)
- JavaScript 문법 검사, 체성분(BIA) 계산, OKOK 블루투스 패킷 해석 테스트 완료

## 다음 할 일
- GitHub 저장소 생성 및 `01_okok_scale_app` 폴더 업로드
- GitHub Pages 활성화 후 갤럭시 S25+ Chrome에서 앱 설치 및 체중계 연동 테스트
