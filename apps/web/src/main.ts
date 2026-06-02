import "./app.css";
import App from "./App.svelte";
import { mount } from "svelte";
import { registerSW } from "virtual:pwa-register";

const target = document.getElementById("app");
if (!target) {
  throw new Error("Missing #app mount point");
}

mount(App, { target });

registerSW({
  onRegisteredSW(swUrl) {
    // eslint-disable-next-line no-console
    console.info("[tunex] service worker registered:", swUrl);
  },
});
