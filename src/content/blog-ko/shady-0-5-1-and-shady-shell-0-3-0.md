---
title: "Shady 0.5.1과 shady-shell 0.3.0: 조금 더 편안한 데스크톱"
description: "Shady의 레이어 순서 수정과 shady-shell의 새로운 데스크톱 도구와 꾸미기 기능을 소개합니다."
pubDate: 2026-11-15
translatedFrom: 2026-11-15
heroImage: "../../assets/nixchan/nixchan-release-party-01.png"
---

**[Shady 0.5.1](https://github.com/gloaming-dusk/shady/releases/tag/v0.5.1)**과 **[shady-shell 0.3.0](https://github.com/gloaming-dusk/shady-shell/releases/tag/v0.3.0)**이 나왔어요. 하나는 작지만 중요한 컴포지터 문제를 고치고, 다른 하나는 데스크톱을 만들고 쓰는 도구를 크게 늘렸습니다.

## 올바른 레이어 순서

spatial 모드 밖에서 top 레이어 표면이 overlay보다 나중에 나타나면 overlay를 가리고 클릭까지 가로챌 수 있었어요. Shady 0.5.1은 표면이 나타난 순서와 상관없이 지정된 레이어 순서를 지킵니다. 자동화 probe를 overlay 레이어로 띄우는 옵션도 추가했어요.

## 할 일이 많아진 셸

shady-shell 0.3.0에는 앱을 고정·해제하고 드래그로 순서를 바꿀 수 있는 독이 생겼어요. 메뉴에서 창 관련 동작도 할 수 있습니다. 스크린샷 선택기는 영역, 창 또는 화면을 골라 `~/Pictures/Screenshots`에 저장하고 클립보드에도 복사해요. grim이나 wl-copy는 필요하지 않습니다.

셸이 클립보드의 텍스트와 그림을 직접 주고받으며, 이력 패널은 복사한 항목과 핀을 재시작 후에도 보관해요. 설정 앱에서는 배경 미리보기, 독 고정 앱, 클립보드 이력과 방해금지 시간을 비롯해 외관·창·입력을 다룰 수 있습니다.

작은 사용성 개선도 있어요. 포커스를 잃으면 닫히도록 설정한 팝업은 바탕화면이나 창을 클릭해도 닫히고, 바와 독의 클릭은 유지됩니다.

## 나만의 모습 만들기

rice 제작자를 위해 누름 스타일, pop·jelly·clack 스프링, 글자 외곽선과 그림자, 기기 제어·알림·달력 등의 공용 모듈도 마련했어요. Meridian은 셸의 기본 화면이고, 다른 rice는 공용 도구를 이용해 각자의 모습을 만들 수 있습니다.

배경 관리자는 그림을 부드럽게 전환하고 선택을 기억해요. 모든 rice가 모든 기능을 같은 모습으로 제공한다는 뜻은 아니고, 각자의 데스크톱을 만들 수 있는 도구들입니다.

## 작은 릴리스 파티

닉스쨩과 요이가 두 릴리스를 소개하는 [4쪽 만화](/comics/nixchan-yoi-release-party/)를 만들었어요. 파란 선물은 컴포지터, 보라색 선물은 셸이에요. 요이가 shell을 조금 너무 문자 그대로 받아들인 것 같지만요.

자세한 내용은 [Shady 0.5.1 릴리스 노트](https://github.com/gloaming-dusk/shady/releases/tag/v0.5.1)와 [shady-shell 0.3.0 릴리스 노트](https://github.com/gloaming-dusk/shady-shell/releases/tag/v0.3.0)에서 볼 수 있어요.
