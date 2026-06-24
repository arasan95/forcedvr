var enableDvr = undefined;

config().then((c) => {
  enableDvr = c.enableDvr;
});

browser.storage.sync.onChanged.addListener((changes) => {
  if (changes.enableDvr) {
    enableDvr = changes.enableDvr.newValue;
  }
});

function patch(details) {
  const log = logContext("patch");
  if (!enableDvr) {
    log(`Not patching ${details.url} because DVR is disabled`);
    return {};
  }

  log(`Patching ${details.url}`);

  let filter = browser.webRequest.filterResponseData(details.requestId);
  let decoder = new TextDecoder("utf-8");
  let encoder = new TextEncoder();
  let response = "";

  filter.ondata = (event) => {
    response += decoder.decode(event.data, { stream: true });
  };
  filter.onstop = (event) => {
    response += decoder.decode();
    response = response.replace(
      /"isLiveDvrEnabled"\s*:\s*false/g,
      '"isLiveDvrEnabled":true'
    );
    filter.write(encoder.encode(response));
    filter.close();
  };

  return {};
}

browser.webRequest.onBeforeRequest.addListener(
  patch,
  {
    urls: [
      "https://www.youtube.com/watch?*",
      "https://www.youtube.com/youtubei/v1/player?*",
      "https://www.youtube.com/*/live",
      "https://www.youtube.com/live/*",
      "https://www.youtube.com/embed/*",
    ],
    types: ["main_frame", "xmlhttprequest"],
  },
  ["blocking"]
);
