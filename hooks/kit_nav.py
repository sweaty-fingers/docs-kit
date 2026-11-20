"""MkDocs hook (last in the list): put the tabs that hooks added in the standard menu order (docs-standard §2).

Hooks add their tab when the project's nav does not list it (ADR, 검증 기록, 현황판, 문서 지도, 실행 가이드, ...), each
at the end or at a place of its own. This hook moves every such added tab to just after the last tab that comes before
it in the standard order (hooks/kitconf.py RANK), so a project gets the same menu whichever tabs it turned on. Tabs the
project wrote in its own nav stay where they are, and so do titles the kit does not know.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kitconf  # noqa: E402


def on_config(config, **kwargs):
    nav = config["nav"]
    if not nav:
        return config
    original = kitconf.nav_state["original"]
    added = [it for it in nav if kitconf.title_of(it) in kitconf.RANK and kitconf.title_of(it) not in original]
    if not added:
        return config
    for it in added:
        nav.remove(it)
    for it in sorted(added, key=lambda x: kitconf.RANK[kitconf.title_of(x)]):
        r = kitconf.RANK[kitconf.title_of(it)]
        at = 0
        for i, other in enumerate(nav):
            t = kitconf.title_of(other)
            if t in kitconf.RANK and kitconf.RANK[t] < r:
                at = i + 1
            elif t is None and isinstance(other, str) and r > 0:
                at = max(at, i + 1)       # a bare page at the top (e.g. README.md) stays first
        nav.insert(at, it)
    return config
