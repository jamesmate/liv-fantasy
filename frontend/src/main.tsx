import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import { registerSW } from "virtual:pwa-register";
import { theme } from "./theme";
import App from "./App";

// registerType: "autoUpdate" (see vite.config.ts) already makes the
// service worker apply a new version automatically once it finds one
// - but by default it only CHECKS for a new version when the app is
// freshly loaded/navigated to. If someone leaves the app open in the
// background for a long session (very likely on mobile, where the
// PWA rarely gets fully closed), it could go hours without ever
// checking, which is exactly the "why hasn't my update shown up"
// friction this app has hit a few times now. Polling registration.
// update() periodically means it'll pick up a new deploy within a
// minute even if the tab/app is never closed and reopened.
const UPDATE_CHECK_INTERVAL_MS = 60_000;
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    setInterval(() => registration.update(), UPDATE_CHECK_INTERVAL_MS);
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <App />
    </MantineProvider>
  </React.StrictMode>
);
