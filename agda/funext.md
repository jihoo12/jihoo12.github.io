# Congruence & Functional Extensionality
```agda
{-# OPTIONS --cubical #-}
module cong where

open import Agda.Primitive.Cubical
open import Agda.Builtin.Cubical.Path

cong : {A B : Set} (f : A → B) {x y : A} (p : x ≡ y) → (f x ≡ f y)
cong f p = λ i → f (p i)

funExt : {A B : Set} {f g : A → B} → ((x : A) → f x ≡ g x) → f ≡ g
funExt p = λ i x → p x i
```