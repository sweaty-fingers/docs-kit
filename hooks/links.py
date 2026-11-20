"""MkDocs hook: short addresses, links to the project's other servers, dev-only parts.

1. Short addresses. In mkdocs.yml

       extra:
         links:
           shared_port: 8000        # port of the shared (deployed) site, see 3.
           short:
             - {name: vr-0002, to: "rerun:nas/records/VR-0002/demo.rrd", title: VR-0002 기록}
             - {name: c4, to: adr/c4.md, title: 아키텍처 뷰어}

   make site pages r/<name>/index.html that forward to the target, so
   http://<host>:<port>/r/vr-0002/ opens it. `to` is a page in docs/ (.md),
   `rerun:<path>` (the Rerun viewer with that file from the file server, ports
   from extra.rerun, as in hooks/rerun_embed.py), `catalog:<port>[@<viewer port>]` (the
   Rerun viewer, extra.rerun.web_port unless given, connected to a Rerun catalog server
   on that port: lists of recordings)
   or `port:<port>/<path>` (another server on the same host). The host is always the one the reader used, so the
   pages work on any server. `<!-- short-links -->` in a page becomes a table of
   them. Unknown pages are logged as WARNING.

2. In any page, a Markdown link to `rerun:<path>`, `catalog:<port>` or `port:<port>/<path>`
   opens that server on the reader's host, e.g. [기록](rerun:nas/records/VR-0002/demo.rrd),
   [데이터 목록](catalog:9095), [개발 미리보기](port:8001/). The link text stays as written.

3. A block `<div class="kit-dev-only" markdown> ... </div>` shows only when the
   page is NOT served on extra.links.shared_port (e.g. on the development
   preview), so the shared site shows shared addresses only.

Script: assets/_kit/javascripts/links.js. Style: assets/_kit/stylesheets/theme.css.
"""
import html
import json
import logging
import os
import re

log = logging.getLogger("mkdocs.plugins.docs_kit.links")
_NAME = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
_HREF = re.compile(r'<a href="(rerun|catalog|port):([^"]*)"')
_EXTERNAL = ("rerun:", "catalog:", "port:")
_DEV = re.compile(r'(<[a-zA-Z][^<>]*?\s)class="kit-dev-only"')  # real tags only, not text in <code>
_MARK = re.compile(r"^[ \t]*<!--\s*short-links\s*-->[ \t]*$", re.M)
_RERUN = {"web_port": 9090, "file_port": 9091}
_state = {"short": [], "pages": {}}


def _cfg(config):
    extra = config.get("extra") or {}
    links = extra.get("links") or {}
    rerun = dict(_RERUN)
    rerun.update(extra.get("rerun") or {})
    return links, rerun


def on_config(config, **kwargs):
    links, _ = _cfg(config)
    short, seen = [], set()
    for e in links.get("short") or []:
        name, to = str(e.get("name", "")), str(e.get("to", ""))
        if not _NAME.match(name) or not to or name in seen:
            log.warning("links: short address needs a unique lower-case name and a target: %s", e)
            continue
        seen.add(name)
        short.append({"name": name, "to": to, "title": str(e.get("title", ""))})
    _state["short"] = short
    return config


def on_files(files, config, **kwargs):
    _state["pages"] = {f.src_uri: f.dest_uri for f in files.documentation_pages()}
    for s in _state["short"]:
        if not s["to"].startswith(_EXTERNAL) and s["to"] not in _state["pages"]:
            log.warning("links: short address r/%s/ points to %s, which is not a page in docs/", s["name"], s["to"])
    return files


def _kind(to):
    if to.startswith("rerun:"):
        return "Rerun 기록 <code>%s</code>" % html.escape(to[6:])
    if to.startswith("catalog:"):
        return "Rerun 기록 목록 (카탈로그 <code>:%s</code>)" % html.escape(to[8:].partition("@")[0])
    if to.startswith("port:"):
        return "같은 PC의 <code>:%s</code>" % html.escape(to[5:])
    return "문서 <code>%s</code>" % html.escape(to)


def on_page_markdown(markdown, page, config, **kwargs):
    if "short-links" not in markdown or not _MARK.search(markdown):
        return markdown
    depth = page.file.dest_uri.count("/")
    up = "../" * depth
    rows = ["| 짧은 주소 | 열리는 곳 | 설명 |", "| --- | --- | --- |"]
    for s in _state["short"]:
        href = f"{up}r/{s['name']}/index.html"
        rows.append(f'| <a class="kit-short" href="{href}" data-path="/r/{s["name"]}/">/r/{s["name"]}/</a> '
                    f"| {_kind(s['to'])} | {html.escape(s['title'])} |")
    if not _state["short"]:
        rows.append("| (없음) | `mkdocs.yml`의 `extra.links.short`에 추가 | |")
    return _MARK.sub(lambda m: "\n".join(rows), markdown)


def _attrs(kind, rest, rerun):
    if kind == "rerun":
        return (f'data-kit-rerun="{html.escape(rest, quote=True)}" data-web-port="{rerun["web_port"]}" '
                f'data-file-port="{rerun["file_port"]}"')
    if kind == "catalog":
        port, _, web = rest.partition("@")
        return (f'data-kit-catalog="{html.escape(port, quote=True)}" '
                f'data-web-port="{html.escape(web or str(rerun["web_port"]), quote=True)}"')
    port, _, path = rest.partition("/")
    return f'data-kit-port="{html.escape(port, quote=True)}" data-kit-path="/{html.escape(path, quote=True)}"'


def on_page_content(content, page, config, **kwargs):
    links, rerun = _cfg(config)
    if "rerun:" in content or "catalog:" in content or "port:" in content:
        content = _HREF.sub(lambda m: f'<a href="#" {_attrs(m.group(1), html.unescape(m.group(2)), rerun)}', content)
    if "kit-dev-only" in content:
        port = html.escape(str(links.get("shared_port", "")), quote=True)
        content = _DEV.sub(lambda m: f'{m.group(1)}class="kit-dev-only" data-shared-port="{port}"', content)
    return content


_PAGE = """<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>{refresh}
<script>(function () {{
  var t = {target};
  location.replace(t(location.hostname || "localhost"));
}})();</script>
</head><body style="font-family:sans-serif;padding:16px">
<p>이동 중입니다. 자동으로 열리지 않으면 <a id="to" href="{fallback}">여기</a>를 누릅니다.</p>
<script>document.getElementById("to").href = ({target})(location.hostname || "localhost");</script>
</body></html>
"""


def _target_js(to, rerun, dest_rel):
    if to.startswith("rerun:"):
        path = json.dumps(to[6:])
        return ("function (h) { var f = 'http://' + h + ':%s/' + %s; "
                "return 'http://' + h + ':%s/?url=' + encodeURIComponent(f); }"
                % (rerun["file_port"], path, rerun["web_port"]))
    if to.startswith("catalog:"):
        port, _, web = to[8:].partition("@")
        return ("function (h) { return 'http://' + h + ':%s/?url=' + encodeURIComponent('rerun+http://' + h + ':' + %s); }"
                % (web or rerun["web_port"], json.dumps(port)))
    if to.startswith("port:"):
        port, _, path = to[5:].partition("/")
        return "function (h) { return location.protocol + '//' + h + ':%s/' + %s; }" % (port, json.dumps(path))
    return "function () { return %s; }" % json.dumps(dest_rel)


def on_post_build(config, **kwargs):
    _, rerun = _cfg(config)
    for s in _state["short"]:
        to = s["to"]
        dest_rel = ""
        if not to.startswith(_EXTERNAL):
            dest = _state["pages"].get(to)
            if not dest:
                continue
            dest_rel = "../../" + dest
        out = os.path.join(config["site_dir"], "r", s["name"], "index.html")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        refresh = f'\n<meta http-equiv="refresh" content="0; url={html.escape(dest_rel, quote=True)}">' if dest_rel else ""
        with open(out, "w", encoding="utf-8") as f:
            f.write(_PAGE.format(title=html.escape(s["title"] or s["name"]), refresh=refresh,
                                 target=_target_js(to, rerun, dest_rel), fallback=html.escape(dest_rel or "#", quote=True)))
