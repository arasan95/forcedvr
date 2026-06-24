(function () {
  const DVR_FIELD = "isLiveDvrEnabled";
  const DVR_DISABLED_RE = /"isLiveDvrEnabled"\s*:\s*false/g;
  const patchedResponses = new WeakSet();
  const xhrUrls = new WeakMap();

  function patchText(text) {
    if (typeof text !== "string" || !text.includes(DVR_FIELD)) {
      return text;
    }

    return text.replace(DVR_DISABLED_RE, '"isLiveDvrEnabled":true');
  }

  function patchObject(value, seen) {
    if (!value || typeof value !== "object") {
      return value;
    }

    if (!seen) {
      seen = new WeakSet();
    } else if (seen.has(value)) {
      return value;
    }
    seen.add(value);

    if (value[DVR_FIELD] === false) {
      value[DVR_FIELD] = true;
    }

    for (const key of Object.keys(value)) {
      patchObject(value[key], seen);
    }

    return value;
  }

  function isPatchableUrl(url) {
    if (!url) {
      return false;
    }

    try {
      const parsed = new URL(url, location.href);
      return (
        parsed.hostname.endsWith("youtube.com") &&
        (parsed.pathname === "/watch" ||
          parsed.pathname === "/live" ||
          parsed.pathname.startsWith("/embed/") ||
          parsed.pathname.startsWith("/youtubei/v1/player"))
      );
    } catch (error) {
      return false;
    }
  }

  function contentLooksPatchable(response) {
    const contentType = response.headers.get("content-type") || "";
    return (
      contentType.includes("json") ||
      contentType.includes("text") ||
      contentType.includes("html") ||
      contentType === ""
    );
  }

  async function patchFetchResponse(response) {
    if (
      patchedResponses.has(response) ||
      !isPatchableUrl(response.url) ||
      !contentLooksPatchable(response)
    ) {
      return response;
    }

    patchedResponses.add(response);

    let text;
    try {
      text = await response.clone().text();
    } catch (error) {
      return response;
    }

    const patchedText = patchText(text);
    if (patchedText === text) {
      return response;
    }

    const headers = new Headers(response.headers);
    headers.delete("content-length");

    const patchedResponse = new Response(patchedText, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    patchedResponses.add(patchedResponse);
    return patchedResponse;
  }

  function installInitialPlayerResponsePatch() {
    let currentValue = patchObject(window.ytInitialPlayerResponse);

    Object.defineProperty(window, "ytInitialPlayerResponse", {
      get() {
        return currentValue;
      },
      set(value) {
        currentValue = patchObject(value);
      },
      configurable: true,
    });
  }

  function installFetchPatch() {
    if (typeof window.fetch !== "function") {
      return;
    }

    const nativeFetch = window.fetch;
    window.fetch = function (...args) {
      return nativeFetch.apply(this, args).then(patchFetchResponse);
    };
  }

  function installXhrPatch() {
    if (typeof window.XMLHttpRequest !== "function") {
      return;
    }

    const proto = window.XMLHttpRequest.prototype;
    const nativeOpen = proto.open;
    const responseTextDescriptor = Object.getOwnPropertyDescriptor(
      proto,
      "responseText"
    );
    const responseDescriptor = Object.getOwnPropertyDescriptor(proto, "response");

    proto.open = function (method, url, ...args) {
      xhrUrls.set(this, url);
      return nativeOpen.call(this, method, url, ...args);
    };

    if (responseTextDescriptor && responseTextDescriptor.get) {
      Object.defineProperty(proto, "responseText", {
        get() {
          const text = responseTextDescriptor.get.call(this);
          return isPatchableUrl(xhrUrls.get(this)) ? patchText(text) : text;
        },
        configurable: true,
      });
    }

    if (responseDescriptor && responseDescriptor.get) {
      Object.defineProperty(proto, "response", {
        get() {
          const value = responseDescriptor.get.call(this);
          if (!isPatchableUrl(xhrUrls.get(this))) {
            return value;
          }

          if (typeof value === "string") {
            return patchText(value);
          }

          if (this.responseType === "json") {
            return patchObject(value);
          }

          return value;
        },
        configurable: true,
      });
    }
  }

  installInitialPlayerResponsePatch();
  installFetchPatch();
  installXhrPatch();
})();
