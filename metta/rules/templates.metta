; Umeme GridMind - bounded library of candidate rule templates.
;
; The agent can only grow by instantiating these templates with one of the
; listed parameter options. Instantiation happens in MeTTa:
;   !(match &self (template <name> $params $rule) (let $params <option> (quote $rule)))

(template anticipate-ramp ($margin)
  (rule (anticipate-ramp $margin) 20
        (> (- (f forecast-net-peak) (f thermal-committed)) (* $margin (f thermal-ramp)))
        (set thermal-mode anticipate)
        "Commit thermal capacity ahead of a forecast net-load peak that ramp limits would otherwise miss."))
(param-option anticipate-ramp (1))
(param-option anticipate-ramp (2))
(param-option anticipate-ramp (4))

(template reserve-floor ($floor)
  (rule (reserve-floor $floor) 15
        (> (f forecast-day-peak) (f thermal-capacity))
        (set battery-floor $floor)
        "Hold battery energy in reserve while a later peak is forecast to exceed thermal capacity."))
(param-option reserve-floor (0.3))
(param-option reserve-floor (0.5))

(template thermal-first ()
  (rule thermal-first 12
        (> (f deficit) 0)
        (set battery-priority last)
        "Serve deficits from committed thermal capacity first; keep the battery for gaps thermal cannot cover."))
(param-option thermal-first ())

(template charge-from-thermal ($soc)
  (rule (charge-from-thermal $soc) 12
        (and (> (f forecast-day-peak) (f thermal-capacity)) (< (f battery-soc) $soc))
        (set charge-from-thermal on)
        "Use spare committed thermal capacity to charge the battery before a forecast peak."))
(param-option charge-from-thermal (0.6))
(param-option charge-from-thermal (0.9))
