; Umeme GridMind - experience diagnosis.
;
; After a run, each problem step becomes an episode: its measurements are
; asserted as (ev <name> <value>) atoms. Failure patterns are symbolic rules
; over those measurements; remedies map a pattern to candidate templates.

(= (e $k) (match &self (ev $k $v) $v))

(pattern commitment-lag
  (and (> (e unserved-mw) 0)
       (or (> (e thermal-uncommitted-mw) 0) (> (e recent-ramp-shortfall-mw) 0)))
  "Demand went unserved while thermal capacity was uncommitted or still ramping up in the preceding hour (ramp lag).")

(pattern premature-depletion
  (and (> (e unserved-mw) 0) (> (e battery-discharged-earlier-mwh) 0))
  "Demand went unserved after the battery had been drained earlier in the day.")

(pattern congestion-loss
  (> (e congestion-curtail-mw) 0)
  "Renewable output was curtailed by a transmission-link limit.")

(= (match-pattern $name $cond $desc) (if $cond (matched $name) (unmatched $name)))

(= (diagnose)
   (match &self (pattern $name $cond $desc) (match-pattern $name $cond $desc)))

(remedy commitment-lag anticipate-ramp)
(remedy commitment-lag thermal-first)
(remedy premature-depletion reserve-floor)
(remedy premature-depletion thermal-first)
(remedy premature-depletion charge-from-thermal)
; congestion-loss deliberately has no remedy: fixing it needs network
; reinforcement, which is outside the agent's action space.
