; Umeme GridMind - core reasoning helpers.
;
; Grid observations are asserted into the space as (fact <name> <value>) atoms
; for the duration of one decision. Policy rules are data atoms:
;   (rule <name> <priority> <condition> <directive> <description>)
; A rule fires when MeTTa evaluates its condition to True against the facts.

(= (f $k) (match &self (fact $k $v) $v))

(= (evaluate-rule $name $prio $cond $directive)
   (if $cond (fired $name $prio $directive) (not-fired $name)))

(= (decide)
   (match &self (rule $name $prio $cond $directive $desc)
          (evaluate-rule $name $prio $cond $directive)))
