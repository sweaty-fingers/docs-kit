/* Zoom, pan and full screen for Mermaid diagrams (docs-kit).
 *
 * Material renders each ```mermaid block into <div class="mermaid"> with a CLOSED shadow root, so the SVG
 * cannot be reached. Instead the host element is wrapped in a frame and scaled as a whole (vector, stays sharp):
 *
 *   .dk-diagram                      frame (full screen target)
 *     .dk-diagram__bar               − / + / 맞춤 / 100% / 전체 화면
 *     .dk-diagram__view              scroll area: drag to pan, Ctrl/⌘ + wheel to zoom
 *       .dk-diagram__sizer           sized to the scaled diagram so the scrollbars are right
 *         div.mermaid                the host, transform: scale(s)
 *
 * Scale 1 = the width Material gave the diagram on the page. Nothing else on the page changes.
 */
(function () {
  "use strict";
  var MIN = 0.25, MAX = 8, STEP = 1.25;

  function button(label, title, onClick) {
    var b = document.createElement("button");
    b.type = "button"; b.textContent = label; b.title = title; b.setAttribute("aria-label", title);
    b.addEventListener("click", onClick);
    return b;
  }

  function wrap(host) {
    var rect = host.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;           // not rendered yet
    var baseW = rect.width, baseH = rect.height, s = 1;

    var frame = document.createElement("div"); frame.className = "dk-diagram";
    var bar = document.createElement("div"); bar.className = "dk-diagram__bar";
    var view = document.createElement("div"); view.className = "dk-diagram__view";
    var sizer = document.createElement("div"); sizer.className = "dk-diagram__sizer";
    var pct = document.createElement("span"); pct.className = "dk-diagram__pct";
    host.parentNode.insertBefore(frame, host);
    sizer.appendChild(host); view.appendChild(sizer); frame.appendChild(bar); frame.appendChild(view);
    host.style.width = baseW + "px";
    host.style.transformOrigin = "0 0";

    function apply(next, cx, cy) {
      next = Math.min(MAX, Math.max(MIN, next));
      // keep the point under (cx, cy) (view coordinates) where it is
      var px = cx === undefined ? view.clientWidth / 2 : cx, py = cy === undefined ? view.clientHeight / 2 : cy;
      var fx = (view.scrollLeft + px) / s, fy = (view.scrollTop + py) / s;
      s = next;
      host.style.transform = "scale(" + s + ")";
      sizer.style.width = baseW * s + "px"; sizer.style.height = baseH * s + "px";
      view.scrollLeft = fx * s - px; view.scrollTop = fy * s - py;
      pct.textContent = Math.round(s * 100) + "%";
      frame.dataset.scale = s.toFixed(3);
    }
    function fit() {
      var sw = (view.clientWidth - 2) / baseW, sh = (view.clientHeight - 2) / baseH;
      apply(document.fullscreenElement === frame ? Math.min(sw, sh) : Math.min(1, sw));
      view.scrollLeft = 0; view.scrollTop = 0;
    }

    bar.appendChild(button("−", "축소", function () { apply(s / STEP); }));
    bar.appendChild(pct);
    bar.appendChild(button("+", "확대", function () { apply(s * STEP); }));
    bar.appendChild(button("맞춤", "화면에 맞추기", fit));
    bar.appendChild(button("100%", "페이지 너비 그대로", function () { apply(1); view.scrollLeft = 0; view.scrollTop = 0; }));
    if (frame.requestFullscreen) {
      bar.appendChild(button("전체 화면", "전체 화면 (Esc로 닫기)", function () {
        if (document.fullscreenElement === frame) document.exitFullscreen(); else frame.requestFullscreen();
      }));
      frame.addEventListener("fullscreenchange", function () { setTimeout(fit, 50); });
    }
    var hint = document.createElement("span"); hint.className = "dk-diagram__hint";
    hint.textContent = "끌어서 이동 · Ctrl/⌘+휠로 확대";
    bar.appendChild(hint);

    view.addEventListener("wheel", function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;                          // plain wheel scrolls the page as usual
      e.preventDefault();
      var r = view.getBoundingClientRect();
      apply(s * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    var drag = null;
    view.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, l: view.scrollLeft, t: view.scrollTop };
      view.setPointerCapture(e.pointerId); view.classList.add("is-dragging");
    });
    view.addEventListener("pointermove", function (e) {
      if (!drag) return;
      view.scrollLeft = drag.l - (e.clientX - drag.x); view.scrollTop = drag.t - (e.clientY - drag.y);
    });
    function end() { drag = null; view.classList.remove("is-dragging"); }
    view.addEventListener("pointerup", end); view.addEventListener("pointercancel", end);

    apply(1);
    frame.dkZoom = { apply: apply, fit: fit, scale: function () { return s; } };   // for tests (bin/selftest.sh)
    return true;
  }

  function scan() {
    var hosts = document.querySelectorAll("div.mermaid:not([data-dk-zoom])");
    for (var i = 0; i < hosts.length; i++) {
      if (hosts[i].closest(".dk-diagram")) continue;
      if (wrap(hosts[i])) hosts[i].setAttribute("data-dk-zoom", "1");
    }
  }

  // Material renders Mermaid asynchronously (after loading it): watch for the hosts to appear.
  var pending = null;
  new MutationObserver(function () {
    if (pending) return;
    pending = setTimeout(function () { pending = null; scan(); }, 100);
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("load", function () { setTimeout(scan, 300); });
  // Diagrams inside closed <details> or inactive tabs have no size until shown.
  document.addEventListener("click", function () { setTimeout(scan, 150); });
})();
