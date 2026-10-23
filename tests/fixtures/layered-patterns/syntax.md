# Layered pattern recognition

This fixture implements the final pattern recognition rules. The production bootstrap retains its current format until all readers support the new DOM. The shared cases compare its syntax trees with the bootstrap reader.

```jbogenbau
%rule pattern-literal
  "#" pattern-primary

%rule pattern-union
  {pattern-intersection / ("∪" | "∖")}

%rule pattern-intersection
  {pattern-path / "∩"}

%rule pattern-path
  ("⋮" | "⋱") pattern-primary | pattern-primary ["⋰"]

%rule pattern-primary
  pattern-node | pattern-bare | "(" pattern-union ")"

%rule pattern-node
  [$exact:"·"] $atom:pattern-atom [$list:pattern-children]
%conditions
  $exact ⟹ $exact.onward.begins(pattern-exact-start)
  , $list ⟹ $atom.onward.begins(pattern-attached-start)
  , ¬$list ⟹ ¬$atom.onward.begins(pattern-attached-start)

%rule pattern-bare
  [$exact:"·"] pattern-children
%conditions
  $exact ⟹ $exact.onward.begins(pattern-exact-start)

%rule pattern-atom
  (pattern-name | tag | string | range | wildcard | constant-reference) [{symbol-test}]

%rule pattern-name
  Lowercase-Name | Emoji-Name | call | parameter

%rule pattern-children
  "«" [child-choice] "»"

%rule child-choice
  {child-alternative / "|"}

%rule child-alternative
  child-sequence | child-set

%rule child-sequence
  {child-item}

%rule child-set
  child-intersection ("∪" | "∖") child-intersection [{("∪" | "∖") child-intersection}]
  | child-path "∩" child-path [{"∩" child-path}]

%rule child-intersection
  {child-path / "∩"}

%rule child-item
  child-path | pattern-brackets | pattern-repeat | "⋯"
%conditions
  ¬$.last-token.onward.begins(pattern-adjacent-item)

%rule child-path
  ("⋮" | "⋱") child-primary | child-primary ["⋰"]

%rule child-primary
  pattern-node | pattern-bare | "(" child-choice ")"

%rule pattern-brackets
  "[" child-choice "]"

%rule pattern-repeat
  "{" child-choice ["/" child-choice] "}"

%rule pattern-exact-start
  $mark:"·" $next:_
%conditions
  $.source-text = $mark.source-text ++ $next.source-text

%rule pattern-attached-start
  $atom:pattern-atom $open:"«"
%conditions
  $.source-text = $atom.source-text ++ $open.source-text

%rule pattern-item-opening
  "«" | "·"

%rule pattern-adjacent-item
  $left:_ $right:pattern-item-opening
%conditions
  $left.value ≠ "⋯"
  , $left.value ≠ "⋰"
  , $.source-text = $left.source-text ++ $right.source-text
```
