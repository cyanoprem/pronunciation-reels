// Browser dev shim for window.WebviewBridge.
// No-op in native (real bridge is already injected). See docs/webview-bridge.md.
// Loaded only in development from app/layout.tsx.
(function installBridgeShim() {
  if (typeof window === "undefined") return;
  if (window.WebviewBridge) return;
  if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) return;

  var ctx = {
    host: { isNative: false, platform: "web", bridgeVersion: 1 },
  };

  window.WebviewBridge = {
    getContext: function () {
      return ctx;
    },
    emit: function (type, payload) {
      console.warn("[webview-bridge shim]", type, payload);
    },
    on: function () {
      return function () {};
    },
  };
})();
