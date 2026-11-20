#!/usr/bin/env python3
"""Compare two built docs sites (prd.md MIG-4): the MkDocs edition (tag v0.15.4) and the Astro edition, or any two builds.

For every page (.html) it compares what readers and links depend on, not the markup:
  - the page list (same addresses, MIG-2)
  - the title (first <h1> of the article)
  - section anchors (id of h2..h6 in the article): a missing one breaks links from elsewhere
  - link targets in the article (internal links resolved to page#anchor, external URLs as they are)

    python3 .docs-kit/bin/site_diff.py OLD/build/site NEW/build/site            # report, exit 1 on differences
    python3 .docs-kit/bin/site_diff.py OLD NEW --allow docs/site-diff-allow.txt   # accepted differences, one per line
    python3 .docs-kit/bin/site_diff.py OLD NEW --json                            # machine-readable

An allow-list line is matched as a prefix of the reported line (e.g. "only-old 404.html", "anchor-new adr/c4.html #").
Standard library only.
"""
from __future__ import annotations

import argparse
import json
import os
import posixpath
import re
import sys
from html.parser import HTMLParser
from urllib.parse import unquote

SKIP = re.compile(r"^(_kit/|assets/|search/|_astro/|_pagefind/)|(^|/)(viewer|board)/")


class Article(HTMLParser):
    """Collects h1 text, heading ids and hrefs inside the first <article> (MkDocs Material and the Astro layout both use one)."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0          # <article> nesting
        self.done = False
        self.h1, self.in_h1, self.skip_text = None, False, 0
        self.ids, self.hrefs = [], []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "article" and not self.done:
            self.depth += 1
            return
        if not self.depth:
            return
        if tag in ("h2", "h3", "h4", "h5", "h6") and a.get("id"):
            self.ids.append(a["id"])
        if tag == "h1" and self.h1 is None:
            self.in_h1, self.h1 = True, ""
        if self.in_h1 and (tag in ("a", "span") and ("headerlink" in (a.get("class") or "") or "kit-anchor" in (a.get("class") or ""))):
            self.skip_text += 1
        if tag == "a" and a.get("href") and "headerlink" not in (a.get("class") or "") and "kit-anchor" not in (a.get("class") or ""):
            self.hrefs.append(a["href"])

    def handle_endtag(self, tag):
        if tag == "article" and self.depth:
            self.depth -= 1
            self.done = self.depth == 0
        if tag == "h1":
            self.in_h1 = False
        if self.in_h1 and tag in ("a", "span") and self.skip_text:
            self.skip_text -= 1

    def handle_data(self, data):
        if self.in_h1 and not self.skip_text:
            self.h1 += data


def norm_link(page, href):
    """A link → 'path.html#anchor' relative to the site root, or the URL itself; None for links that do not matter."""
    if href.startswith(("mailto:", "tel:", "javascript:", "data:")):
        return None
    if re.match(r"^[a-z]+://", href):
        return href
    path, _, frag = href.partition("#")
    path = path.split("?")[0]
    if not path:
        target = page
    else:
        target = posixpath.normpath(posixpath.join(posixpath.dirname(page), unquote(path)))
        if target.endswith("/") or not posixpath.splitext(target)[1]:
            target = posixpath.join(target, "index.html")
    return target + ("#" + unquote(frag) if frag else "")


def read_site(root):
    pages = {}
    for dp, dn, fn in os.walk(root):
        for f in fn:
            if not f.endswith(".html"):
                continue
            rel = os.path.relpath(os.path.join(dp, f), root).replace(os.sep, "/")
            if SKIP.search(rel):
                continue
            p = Article()
            p.feed(open(os.path.join(dp, f), encoding="utf-8", errors="replace").read())
            links = {x for x in (norm_link(rel, h) for h in p.hrefs) if x}
            pages[rel] = {"title": re.sub(r"\s+", " ", (p.h1 or "")).strip(), "ids": set(p.ids), "links": links}
    return pages


def diff(old, new):
    out = []
    for rel in sorted(set(old) - set(new)):
        out.append(f"only-old {rel}")
    for rel in sorted(set(new) - set(old)):
        out.append(f"only-new {rel}")
    for rel in sorted(set(old) & set(new)):
        a, b = old[rel], new[rel]
        if a["title"] != b["title"]:
            out.append(f"title {rel}: {a['title']!r} -> {b['title']!r}")
        for i in sorted(a["ids"] - b["ids"]):
            out.append(f"anchor-old {rel} #{i}")
        for i in sorted(b["ids"] - a["ids"]):
            out.append(f"anchor-new {rel} #{i}")
        for t in sorted(a["links"] - b["links"]):
            out.append(f"link-old {rel} -> {t}")
        for t in sorted(b["links"] - a["links"]):
            out.append(f"link-new {rel} -> {t}")
    return out


def main():
    ap = argparse.ArgumentParser(description="Compare two built docs sites: pages, titles, section anchors, link targets.")
    ap.add_argument("old")
    ap.add_argument("new")
    ap.add_argument("--allow", help="file of accepted differences (prefix per line, # comments)")
    ap.add_argument("--json", action="store_true", help="print the differences as JSON")
    a = ap.parse_args()
    old, new = read_site(a.old), read_site(a.new)
    lines = diff(old, new)
    allow = []
    if a.allow and os.path.exists(a.allow):
        allow = [x.strip() for x in open(a.allow, encoding="utf-8") if x.strip() and not x.lstrip().startswith("#")]
    left = [x for x in lines if not any(x.startswith(p) for p in allow)]
    if a.json:
        print(json.dumps({"pages_old": len(old), "pages_new": len(new), "differences": left, "allowed": len(lines) - len(left)},
                         ensure_ascii=False, indent=1))
    else:
        for x in left:
            print(x)
        print(f"site_diff: {len(old)} / {len(new)} pages, {len(left)} difference(s)"
              + (f", {len(lines) - len(left)} allowed" if allow else ""))
    sys.exit(1 if left else 0)


if __name__ == "__main__":
    main()
