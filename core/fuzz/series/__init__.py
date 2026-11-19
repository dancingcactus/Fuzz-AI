"""Series: the bigger things you're working on (docs/series.md).

  settings  every tunable number, in one place
  index     the anchor index: what each task carries, rarity weights, scores, also touches, the rules
  record    the record and its lifecycle: make, link, name, drop, mute, anchors, wrap, seasons, merge
  detect    detection as things come in, and the judge's items and verdicts
  ask       starting one yourself, and the cards (role, new series, season 2, suggestions)
  suggest   the detectors that suggest new tasks
  views     what the Series page and the series sheet show

Import the modules themselves (from fuzz.series import record): the package imports nothing, and the domain
never imports series (the clock's share runs from actions.tick), so it stays out of the domain's import cycle.
"""
