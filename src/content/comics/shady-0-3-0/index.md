---
title: "Shady 0.3.0: 컴포지터만 남기고"
description: "셸, 그리터, rices를 각자의 리포로 보내고 Shady는 컴포지터만 남았어요."
pubDate: 2026-11-11T10:58:52Z
lang: ko
cover: ./cover.webp
pages:
  - src: ./01.webp
    alt: "열 칸짜리 한 장 만화. 닉스쨩이 Shady 0.3.0 출시를 알린다. 예전엔 컴포지터, 셸, 그리터, rices, 플러그인이 한 리포에 있어서 런처만 바뀌어도 데스크톱 전체를 릴리스해야 했지만, 이제 Shady는 컴포지터만 남고 shady-shell, shady-greeter, Gloam, Afterglow·Horizon이 각자의 리포로 나갔다. Shady에는 렌더러, C 플러그인 API, shadyctl, 세션 스크립트, Tide가 남는다. nix run github:gloaming-dusk/shady로 컴포지터만, nix run github:gloaming-dusk/gloam으로 전체 데스크톱을 실행할 수 있고, 셸 없이도 fuzzel, swaylock, wpctl 같은 도구로 쓸 수 있다. rices는 SHADY_RICE_PATH 등 여러 위치에서 찾아 조합한다. 오버뷰 창 축소, fcitx5의 Super 키 오동작, automation.after(0) 타이머, Lua 창 id 버그가 고쳐졌다. 앞으로도 Shady는 실험적인 컴포지터로 남는다."
---

자세한 이야기는 저널 글 [Shady 0.3.0: Just the Compositor](/blog/shady-0-3-0-just-the-compositor/)에 있어요. 페이지를 누르면 크게 볼 수 있어요.
