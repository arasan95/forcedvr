(function () {
  const runtime = typeof browser !== "undefined" ? browser.runtime : chrome.runtime;
  const script = document.createElement("script");
  script.src = runtime.getURL("inject.js");
  script.onload = function () {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
})();
