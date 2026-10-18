; Umeme GridMind - baseline policy (rule version 1).
; Deliberately small and reactive: it only looks at the current step.

(rule cover-deficit-battery-first 10
      (> (f deficit) 0)
      (set battery-priority first)
      "When demand exceeds renewable supply, discharge the battery first and commit thermal capacity only for the remainder.")

(rule charge-on-surplus 10
      (> (f surplus) 0)
      (set charge-from-surplus on)
      "When renewable supply exceeds demand, store the surplus in the battery.")

(rule exclude-unavailable-thermal 30
      (== (f thermal-available) 0)
      (set thermal-mode offline)
      "An unavailable thermal generator cannot be committed or dispatched.")

(rule flag-congestion 5
      (> (f congestion-curtail) 0)
      (alert congestion)
      "Flag renewable output lost to transmission-link limits.")

(rule reserve-alert 5
      (< (f reserve-margin) 5)
      (alert reserve-low)
      "Raise an alert when the reserve margin falls below 5 MW.")
