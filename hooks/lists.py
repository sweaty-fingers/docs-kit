"""Lists as authors mean them (문서 규격 §8): Python-Markdown nests a list only when it is indented 4 spaces per
level and starts a list only after a blank line. Pages written with 2-space nesting, or a list right under a line
of text, came out flat ("미는 힘:" with nothing under it, sub-items as siblings) or glued into one paragraph.

Before rendering (the source files stay as written):
  - a nested list item is moved to 4 spaces per level (2 or 3 spaces under its parent -> one level); the lines that
    belong to that item (continuation text, a fenced code block under it) move with it
  - a blank line is put before a list that directly follows a line of text
Already correct Markdown (4 spaces, blank lines) comes out unchanged. Fenced code, tables, headings, HTML and
blockquotes are left alone.
"""
from __future__ import annotations

import re

ITEM = re.compile(r"^( *)([-*+]|\d{1,9}[.)])( +)(\S.*)?$")
FENCE = re.compile(r"^( *)(```|~~~)")
STEP = 4


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _is_text(line: str) -> bool:
    """A paragraph line (a list right after it would be swallowed into the paragraph)."""
    s = line.strip()
    if not s:
        return False
    return not (s.startswith(("#", "|", ">", "<", "!!!", "???", "```", "~~~", "---", "***", "___", "[//]", ":"))
                or ITEM.match(line) or s.endswith("-->"))


def fix_lists(md: str) -> str:
    out: list[str] = []
    stack: list[tuple[int, int, int]] = []   # open list items: (source indent, new indent, source content column)
    fence = None                              # (fence marker, shift) while inside fenced code
    prev_blank = True
    for line in md.split("\n"):
        if fence is not None:                 # inside fenced code: shift it with its list item, nothing else
            out.append((" " * fence[1] + line) if fence[1] > 0 and line.strip() else line)
            m = FENCE.match(line)
            if m and m.group(2) == fence[0] and not line.strip()[3:].strip():
                fence = None
            prev_blank = False
            continue
        if not line.strip():
            out.append(line)
            prev_blank = True
            continue
        ind = _indent(line)
        m = ITEM.match(line)
        if m:
            while stack and ind < stack[-1][0]:
                stack.pop()                    # back out to the level this item belongs to
            if stack and ind > stack[-1][0]:
                new = stack[-1][1] + STEP      # one level deeper: 4 spaces more than its parent
            elif stack and ind == stack[-1][0]:
                new = stack[-1][1]
                stack.pop()
            else:
                new = ind if ind % STEP == 0 else (ind // STEP) * STEP
                stack.clear()
            content_col = ind + len(m.group(2)) + len(m.group(3))
            if not stack and new == ind and not prev_blank and out and _is_text(out[-1]) \
                    and _indent(out[-1]) <= ind:
                out.append("")                 # a list right under text: give it its blank line
            stack.append((ind, new, content_col))
            out.append(" " * new + line.lstrip(" "))
            prev_blank = False
            continue
        # not an item: does it belong to an open item (indented under it)?
        if stack and prev_blank and ind == 0:
            stack.clear()                      # the list ended
        shift = 0
        for src, new, col in reversed(stack):
            if ind > src:                      # belongs to this item: keep it 4+ spaces in from the item's marker
                rel = ind - src
                shift = (new + rel if rel >= STEP else new + STEP + max(0, ind - col)) - ind
                break
        fm = FENCE.match(line)
        if fm:
            fence = (fm.group(2), shift)
        out.append((" " * shift + line) if shift > 0 else line)
        prev_blank = False
    return "\n".join(out)


def on_page_markdown(markdown, page, config, files):
    return fix_lists(markdown)
