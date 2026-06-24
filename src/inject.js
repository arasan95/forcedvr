(function () {
  const MAX_DVR_SECS = 43200 * 14;
  const DVR_CAP_FLAG = "html5_max_live_dvr_window_plus_margin_secs";

  function modifyPlayerResponse(response) {
    if (!response || typeof response !== "object") {
      return false;
    }

    const videoDetails = response.videoDetails;
    if (!videoDetails || !videoDetails.isLive) {
      return false;
    }

    videoDetails.isLiveDvrEnabled = true;

    const mediaCommonConfig =
      response.playerConfig && response.playerConfig.mediaCommonConfig;
    if (mediaCommonConfig) {
      mediaCommonConfig.useServerDrivenAbr = false;
      if (mediaCommonConfig.serverPlaybackStartConfig) {
        mediaCommonConfig.serverPlaybackStartConfig.enable = false;
      }
    }

    const streamingData = response.streamingData;
    if (streamingData) {
      if (
        streamingData.serverAbrStreamingUrl &&
        (streamingData.hlsManifestUrl || streamingData.dashManifestUrl)
      ) {
        delete streamingData.serverAbrStreamingUrl;
      }

      if (Array.isArray(streamingData.adaptiveFormats)) {
        for (const format of streamingData.adaptiveFormats) {
          format.maxDvrDurationSec = MAX_DVR_SECS;
        }
      }
    }

    return true;
  }

  function patchPlayerResponse(data) {
    if (!data || typeof data !== "object") {
      return false;
    }

    if (modifyPlayerResponse(data)) {
      return true;
    }

    if (data.playerResponse && modifyPlayerResponse(data.playerResponse)) {
      return true;
    }

    return false;
  }

  function installInitialPlayerResponsePatch() {
    const previousDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "ytInitialPlayerResponse"
    );
    const previousSetter = previousDescriptor && previousDescriptor.set;
    let initialResponse = window.ytInitialPlayerResponse;

    if (patchPlayerResponse(initialResponse)) {
      return;
    }

    try {
      Object.defineProperty(window, "ytInitialPlayerResponse", {
        get() {
          return initialResponse;
        },
        set(value) {
          if (previousSetter) {
            previousSetter.call(this, value);
          }

          initialResponse = value;
          if (patchPlayerResponse(value)) {
            Object.defineProperty(window, "ytInitialPlayerResponse", {
              configurable: true,
              writable: true,
              value,
            });
          }
        },
        configurable: true,
      });
    } catch (error) {
      patchPlayerResponse(window.ytInitialPlayerResponse);
    }
  }

  function installJsonParsePatch() {
    const nativeParse = JSON.parse;
    JSON.parse = function (text, reviver) {
      const data = nativeParse.call(this, text, reviver);
      try {
        patchPlayerResponse(data);
      } catch (error) {
        // Keep YouTube running even if its response shape changes.
      }
      return data;
    };
  }

  function liftDvrCap(ytcfg) {
    if (!ytcfg || ytcfg.__forcedvrCapLifted) {
      return;
    }

    const store = typeof ytcfg.d === "function" && ytcfg.d();
    const players = store && store.WEB_PLAYER_CONTEXT_CONFIGS;
    if (!players) {
      return;
    }

    for (const id of Object.keys(players)) {
      const config = players[id];
      if (config && typeof config.serializedExperimentFlags === "string") {
        const flag = new RegExp(DVR_CAP_FLAG + "=[\\d.]+");
        if (flag.test(config.serializedExperimentFlags)) {
          config.serializedExperimentFlags =
            config.serializedExperimentFlags.replace(
              flag,
              DVR_CAP_FLAG + "=" + MAX_DVR_SECS
            );
        } else {
          config.serializedExperimentFlags +=
            "&" + DVR_CAP_FLAG + "=" + MAX_DVR_SECS;
        }
      }
    }

    ytcfg.__forcedvrCapLifted = true;
  }

  function hookYtcfg(ytcfg) {
    if (!ytcfg || ytcfg.__forcedvrHooked) {
      return ytcfg;
    }

    ytcfg.__forcedvrHooked = true;
    const nativeSet = ytcfg.set;
    if (typeof nativeSet === "function") {
      ytcfg.set = function () {
        const result = nativeSet.apply(this, arguments);
        try {
          liftDvrCap(ytcfg);
        } catch (error) {
          // The config is not always complete during early startup.
        }
        return result;
      };
    }

    try {
      liftDvrCap(ytcfg);
    } catch (error) {
      // The next ytcfg.set call will retry.
    }

    return ytcfg;
  }

  function installYtcfgPatch() {
    let ytcfgRef = hookYtcfg(window.ytcfg);

    try {
      Object.defineProperty(window, "ytcfg", {
        get() {
          return ytcfgRef;
        },
        set(value) {
          ytcfgRef = hookYtcfg(value);
        },
        configurable: true,
      });
    } catch (error) {
      hookYtcfg(window.ytcfg);
    }
  }

  installInitialPlayerResponsePatch();
  installJsonParsePatch();
  installYtcfgPatch();
})();
