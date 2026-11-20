"""MkDocs hook: embed a Rerun recording (.rrd) in a page.

In any page, a line

    <!-- rerun: nas/records/VR-0002/demo.rrd -->
    <!-- rerun: local/render/demo.rrd height=480 -->

becomes a box with a "load viewer" button. The path is relative to the project's
Rerun file server; the viewer and file server run on the same host as the docs
site (the page's own hostname), on the ports from mkdocs.yml:

    extra:
      rerun:
        web_port: 9090                       # Rerun web viewer (rerun --serve-web)
        file_port: 9091                      # read-only HTTP file server with CORS
        start: tools/rerun_server.sh start   # shown when the server is not reachable

Nothing loads until the reader clicks (the viewer is ~40 MB, recordings are
large). If the file server does not answer, the box shows the start command.
On GitLab the comment stays a comment, so pages read the same there.
Script and style: assets/_kit/javascripts/rerun-embed.js, assets/_kit/stylesheets/theme.css.
"""
import html
import re

_LINE = re.compile(r"^[ \t]*<!--\s*rerun:\s*(\S+)((?:\s+\w+=\S+)*)\s*-->[ \t]*$", re.M)
_FENCE = re.compile(r"^[ \t]*(`{3,}|~{3,})")
_DEFAULTS = {"web_port": 9090, "file_port": 9091, "start": "tools/rerun_server.sh start"}


def _settings(config):
    s = dict(_DEFAULTS)
    s.update((config.get("extra") or {}).get("rerun") or {})
    return s


def _box(path, opts, s):
    height = int(opts.get("height", 560))
    name = html.escape(path.rsplit("/", 1)[-1])
    attrs = " ".join(
        f'data-{k}="{html.escape(str(v), quote=True)}"'
        for k, v in (("file", path), ("web-port", s["web_port"]), ("file-port", s["file_port"]), ("height", height))
    )
    start = html.escape(str(s["start"]))
    return (
        f'<div class="rerun-embed" {attrs}>'
        f'<div class="rerun-embed__bar"><span class="rerun-embed__name">Rerun · <code>{name}</code></span>'
        f'<span class="rerun-embed__state">서버 확인 중…</span>'
        f'<button type="button" class="rerun-embed__load" disabled>뷰어 불러오기</button>'
        f'<a class="rerun-embed__open" target="_blank" rel="noopener">새 창에서 열기</a></div>'
        f'<div class="rerun-embed__off" hidden>Rerun 서버가 응답하지 않습니다. 문서 서버가 도는 PC에서 '
        f"<code>{start}</code>를 실행한 뒤 이 페이지를 새로고침합니다.</div>"
        f'<div class="rerun-embed__frame"></div></div>'
    )


def on_page_markdown(markdown, page, config, **kwargs):
    if "rerun:" not in markdown:
        return markdown
    s = _settings(config)

    out, fence = [], None
    for line in markdown.split("\n"):
        f = _FENCE.match(line)
        if f:  # leave examples inside code fences (``` or ~~~, any length) as they are
            if fence is None:
                fence = f.group(1)
            elif f.group(1)[0] == fence[0] and len(f.group(1)) >= len(fence) and not line.strip()[len(f.group(1)):]:
                fence = None
        m = None if fence else _LINE.match(line)
        if m:
            opts = dict(kv.split("=", 1) for kv in m.group(2).split())
            line = _box(m.group(1), opts, s)
        out.append(line)
    return "\n".join(out)
