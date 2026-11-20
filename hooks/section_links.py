"""MkDocs hook: make plain section references clickable on the docs site.

The docs refer to sections as plain text ("§4.3", "11 §4") or as links that
point only at a page ("[08 §3.1](08_....md)"). This hook links them to the
numbered heading they name:

  §4.3          -> heading "4.3 ..." on the same page (or a table row whose
                   first cell is "4.3", as in 08's contract table)
  11 §4         -> heading "4. ..." on the page whose file name starts with 11_
  A5 §2, G1 §6, R2 §1 -> heading on arc42/a05_*, guides/g1_*, reference/r2_*
  <a href="08_x.html">08 §3.1</a>  -> href gets "#<id of heading 3.1>"

Text inside code, pre, headings and existing links is left alone, and a
reference is left as plain text when no such heading exists. The markdown
sources are not changed. Enabled by `hooks:` in mkdocs.base.yml.
"""
import re

_HEADING_NUM = re.compile(r"^\s*(\d+(?:\.\d+)*)\.?(?:\s|$)")
_REF = re.compile(r"(?:\b(\d{2}|A\d{1,2}|G\d{1,2}|R\d{1,2})\s)?§\s?(\d+(?:\.\d+)*)")
_TAG = re.compile(r"(<[^>]+>)")
_SKIP = {"code", "pre", "a", "h1", "h2", "h3", "h4", "h5", "h6", "script", "style"}
_ROW_NUM = re.compile(r"<tr>(\s*<td[^>]*>)(\d+\.\d+(?:\.\d+)*)</td>")
_PAGE_LINK = re.compile(r'<a href="([^"#:]+\.html)"([^>]*)>(.*?)</a>', re.S)

_sections = {}  # page url -> {"4.3": "43-장비와-정의-대조", ...}
_doc_urls = {}  # "11" -> page url


def _walk(items, out):
    for item in items:
        m = _HEADING_NUM.match(item.title)
        if m:
            out.setdefault(m.group(1), item.id)
        _walk(item.children, out)


def on_page_content(html, page, **kwargs):
    out = {}
    _walk(page.toc, out)

    def row_anchor(m):
        num = m.group(2)
        if num in out:
            return m.group(0)
        out[num] = "sec-" + num.replace(".", "-")
        return f'<tr id="{out[num]}">{m.group(1)}{num}</td>'

    html = _ROW_NUM.sub(row_anchor, html)
    _sections[page.url] = out
    num = re.match(r"(\d{2})_", page.file.name)
    if num:
        _doc_urls[num.group(1)] = page.url
    # arc42 sections (aNN_), guides (gN_), reference (rN_): "A5 §2", "G1 §6", "R2 §1"
    for prefix, folder in (("A", "arc42"), ("G", "guides"), ("R", "reference")):
        m = re.match(prefix.lower() + r"(\d{1,2})_", page.file.name)
        if m and page.file.src_uri.startswith(folder + "/"):
            _doc_urls[f"{prefix}{int(m.group(1))}"] = page.url
    return html


def _rel(from_url, to_url):
    """Relative href from one page url to another (use_directory_urls: false)."""
    if from_url == to_url:
        return ""
    src, dst = from_url.split("/")[:-1], to_url.split("/")
    common = 0
    while common < len(src) and common < len(dst) - 1 and src[common] == dst[common]:
        common += 1
    return "/".join([".."] * (len(src) - common) + dst[common:])


def _link_text(text, page):
    def repl(m):
        doc, sec = m.group(1), m.group(2)
        target = _doc_urls.get(doc) if doc else page.url
        anchor = _sections.get(target, {}).get(sec) if target else None
        if not anchor:
            return m.group(0)
        return f'<a href="{_rel(page.url, target)}#{anchor}">{m.group(0)}</a>'

    return _REF.sub(repl, text)


def _add_fragment(m, page):
    href, attrs, inner = m.groups()
    sec = _REF.search(re.sub(r"<[^>]+>", "", inner))
    if not sec:
        return m.group(0)
    # Resolve the linked page's url from the href, relative to this page.
    parts = page.url.split("/")[:-1]
    for p in href.split("/"):
        if p == "..":
            parts = parts[:-1]
        elif p not in ("", "."):
            parts.append(p)
    anchor = _sections.get("/".join(parts), {}).get(sec.group(2))
    if not anchor:
        return m.group(0)
    return f'<a href="{href}#{anchor}"{attrs}>{inner}</a>'


def on_page_context(context, page, **kwargs):
    # Runs after every page's on_page_content, so all headings are known here.
    html = _PAGE_LINK.sub(lambda m: _add_fragment(m, page), page.content)
    out, skip = [], []
    for part in _TAG.split(html):
        if part.startswith("<"):
            tag = re.match(r"</?\s*([a-zA-Z0-9]+)", part)
            name = tag.group(1).lower() if tag else ""
            if name in _SKIP and not part.endswith("/>"):
                if part.startswith("</"):
                    if skip and skip[-1] == name:
                        skip.pop()
                else:
                    skip.append(name)
            out.append(part)
        elif not skip and "§" in part:
            out.append(_link_text(part, page))
        else:
            out.append(part)
    page.content = "".join(out)
    return context
