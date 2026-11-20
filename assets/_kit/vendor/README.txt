vendor

Third-party scripts served with the docs site, so pages work without internet
access. Loaded by mkdocs.base.yml (extra_javascript).

| Path | Source (npm) | Version | sha256 | License |
| --- | --- | --- | --- | --- |
| mermaid/mermaid.min.js | mermaid dist/mermaid.min.js | 11.4.1 | a43bc1afd446f9c4cc66ac5dd45d02e8d65e26fc5344ec0ef787f88d6ddb6f9e | MIT (mermaid/LICENSE.txt) |
| mathjax/tex-mml-chtml.js | mathjax es5/tex-mml-chtml.js | 3.2.2 | 300480069078b5892d2363a2b65e2dfbbf30fe5c80f83edbfecf4610fd093862 | Apache-2.0 (mathjax/LICENSE.txt) |
| mathjax/output/chtml/fonts/woff-v2/ | mathjax es5/... (fonts tex-mml-chtml loads) | 3.2.2 | - | Apache-2.0 |
| mathjax/input/tex/extensions/ | mathjax es5/... (TeX packages loaded on demand) | 3.2.2 | - | Apache-2.0 |

Not vendored: MathJax's accessibility explorer (es5/a11y, es5/sre). It loads
only if a reader turns it on from the formula's right-click menu, and then
fails offline; formulas themselves are unaffected.

Mermaid: Material for MkDocs uses a global `mermaid` if one exists and only
otherwise fetches mermaid@11 from unpkg, so the local copy keeps the version
fixed and the site offline. The ADR viewer's elkjs lives in adr/viewer/vendor/.

Update: download the same paths for the new version, update this table, run
bin/selftest.sh and check a page with a diagram and a formula.
