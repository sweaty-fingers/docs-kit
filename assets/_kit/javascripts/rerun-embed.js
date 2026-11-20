/* Rerun recording boxes made by docs-kit hooks/rerun_embed.py.
   The viewer and the file server are on the docs site's host; nothing heavy loads
   until the reader clicks "뷰어 불러오기". Works with Material's instant loading. */
(function () {
  function init(box) {
    if (box.dataset.ready) return;
    box.dataset.ready = "1";
    var host = location.hostname || "localhost";
    var file = "http://" + host + ":" + box.dataset.filePort + "/" + box.dataset.file;
    var viewer = "http://" + host + ":" + box.dataset.webPort + "/?url=" + encodeURIComponent(file);
    var state = box.querySelector(".rerun-embed__state");
    var load = box.querySelector(".rerun-embed__load");
    var open = box.querySelector(".rerun-embed__open");
    var off = box.querySelector(".rerun-embed__off");
    var frame = box.querySelector(".rerun-embed__frame");
    open.href = viewer;

    fetch(file, { method: "HEAD", cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      var mb = Number(r.headers.get("content-length") || 0) / 1e6;
      state.textContent = "준비됨" + (mb ? " · " + mb.toFixed(1) + " MB" : "");
      box.classList.add("is-ready");
      load.disabled = false;
    }).catch(function () {
      state.textContent = "서버 꺼짐";
      box.classList.add("is-off");
      off.hidden = false;
    });

    load.addEventListener("click", function () {
      if (frame.firstChild) return;
      var f = document.createElement("iframe");
      f.src = viewer;
      f.title = "Rerun viewer: " + box.dataset.file;
      f.style.height = box.dataset.height + "px";
      f.setAttribute("allow", "fullscreen");
      frame.appendChild(f);
      load.disabled = true;
      state.textContent = "불러오는 중… (처음은 수십 MB를 받음)";
    });
  }
  function scan() { document.querySelectorAll(".rerun-embed").forEach(init); }
  if (window.document$ && window.document$.subscribe) window.document$.subscribe(scan);
  else document.addEventListener("DOMContentLoaded", scan);
})();
