# learn-agda
## basic
```agda
{-# OPTIONS --cubical #-} --cubical 모드를 활성화합니다.
module filename where -- 파일이름과 모듈이름이 같아야 합니다.
open import Cubical.Core.Primitives --기초 요소를 불러옵니다.
```
## type definition
```agda
data Bool : Set where
  true :Bool
  false :Bool
```
Set은 Ocaml의 type에 해당하며 타입들의 타입을 의미한다.
<br>
where 뒤에 오는것들은 이 타입이 가질수있는 생성자들이다.

## define a function
```agda
not : Bool -> Bool
not true = false
not false = true
```

## practice
```agda
and : Bool -> Bool -> Bool
and true true = true
and _ _ = false
```