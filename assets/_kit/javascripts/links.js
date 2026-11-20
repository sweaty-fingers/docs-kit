/* Links made by docs-kit hooks/links.py: rerun:/catalog:/port: links open on the reader's host,
   short-address cells show the full address, dev-only blocks show off the shared port.
   Works with Material's instant loading. */
(function () {
  function host() { return location.hostname || "localhost"; }
  function apply() {
    var h = host();
    document.querySelectorAll("a[data-kit-rerun]").forEach(function (a) {
      var f = "http://" + h + ":" + a.dataset.filePort + "/" + a.dataset.kitRerun;
      a.href = "http://" + h + ":" + a.dataset.webPort + "/?url=" + encodeURIComponent(f);
      a.target = "_blank"; a.rel = "noopener";
    });
    document.querySelectorAll("a[data-kit-catalog]").forEach(function (a) {   // Rerun catalog server: lists
      a.href = "http://" + h + ":" + a.dataset.webPort + "/?url=" +
               encodeURIComponent("rerun+http://" + h + ":" + a.dataset.kitCatalog);
      a.target = "_blank"; a.rel = "noopener";
    });
    document.querySelectorAll("a[data-kit-port]").forEach(function (a) {
      a.href = location.protocol + "//" + h + ":" + a.dataset.kitPort + a.dataset.kitPath;
      a.target = "_blank"; a.rel = "noopener";
    });
    document.querySelectorAll("a.kit-short[data-path]").forEach(function (a) {
      a.textContent = location.origin + a.dataset.path;
    });
    document.querySelectorAll(".kit-dev-only").forEach(function (d) {
      var shared = d.dataset.sharedPort;
      if (!shared || location.port !== String(shared)) { d.classList.add("is-shown"); return; }
      d.querySelectorAll("[id]").forEach(function (el) {  // hidden: drop its headings from "이 페이지"
        document.querySelectorAll('.md-nav__link[href="#' + el.id + '"]').forEach(function (l) {
          (l.closest("li") || l).style.display = "none";
        });
      });
    });
  }
  if (window.document$ && window.document$.subscribe) window.document$.subscribe(apply);
  else document.addEventListener("DOMContentLoaded", apply);
})();
