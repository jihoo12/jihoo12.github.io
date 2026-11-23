---
title: "Jihoo2 소개: 의존 타입을 뺀 Jihoo"
description: "실험적인 의존 타입 코어는 덜어내고, 소유권과 빌림 검사, LLVM 백엔드는 그대로 둔 Jihoo의 새 버전입니다."
pubDate: 2026-11-23
translatedFrom: 2026-11-23
---

[Jihoo2](https://github.com/jihoo-language/jihoo2)는 [Jihoo](https://github.com/jihoo-language/jihoo)에서 실험적인 의존 타입 체계를 뺀 별도 버전입니다. 수명 표기나 가비지 컬렉터 없이, 소유권과 범위가 정해진 빌림으로 어디까지 시스템 프로그래밍을 할 수 있는지에 더 집중하려고 합니다.

## 무엇을 뺐나

`#![dependent_core]` 모듈, `jihoo core` 명령, `.jhc` 파일, 의존 타입 전용 라이브러리와 그 코어를 위한 Lean 증명은 Jihoo2에 들어가지 않습니다. 그렇다고 검증 자체가 사라진 건 아닙니다. 컴파일러의 중간 표현인 MIR에서 프로그램의 계약을 검사하는 검증기는 그대로예요. 일반 컴파일 타임 제네릭도 남아 있습니다.

## 무엇을 남겼나

소유권 이동과 빌림은 여전히 컴파일러가 검사합니다. 함수는 값을 빌리거나, `inout`으로 수정할 수 있게 빌리거나, `sink`로 소유권을 받을 수 있습니다. 예를 들어 아래 코드는 반복문이 벡터를 빌리고 있는 동안 `push`로 벡터를 변경하려 해서 거부됩니다.

```jihoo
fn main() {
    var v = Vec(i64).new()
    v.push(1)
    for x in v {
        v.push(x)
    }
}
```

컴파일러는 여전히 Jihoo로 작성되어 있고, LLVM으로 네이티브 프로그램을 만듭니다. Nix와 `hello.jh` 파일이 있다면 이렇게 실행해 볼 수 있습니다.

```sh
nix run github:jihoo-language/jihoo2 -- run hello.jh
```

[소스 코드 보기](https://github.com/jihoo-language/jihoo2) · [문서 읽기](https://jihoo-language.github.io/jihoo2/)
