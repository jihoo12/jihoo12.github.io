# Transitivity
```agda
{-# OPTIONS --cubical #-}
module Transitivity where

open import Agda.Primitive.Cubical
open import Agda.Builtin.Cubical.Path

-- [증명] 이행성 (Transitivity)
-- A ≡ B 이고 B ≡ C 이면 A ≡ C 이다.
trans : {A : Set} {x y z : A} 
      → x ≡ y → y ≡ z → x ≡ z
trans {x = x} p q i = primHComp (λ j → λ where 
--이 함수는 p:x≡y와 q:y≡z를 받아서 x≡z라는 새로운 경로를 만들어낸다.
    (i = i0) → x          -- 왼쪽 기둥: 계속 x에 머물러 있는 정지된 경로
    (i = i1) → q j        -- 오른쪽 기둥: j가 변함에 따라 y에서 z로 움직이는 경로 q
  ) (p i)                 -- 바닥:j=i0인상태 x에서 y로 가는 경로 p
```