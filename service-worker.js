const CACHE_NAME = "promptvault-shell-v1";
const SHELL_FILES = ["./", "./index.html", "./styles.css", "./app.js", "./firebase.js", "./manifest.webmanifest", "./icons/promptvault.svg"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // Always try the network for the app document so users receive the latest release.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put("./index.html", copy));
      return response;
    }).catch(() => caches.match("./index.html")));
    return;
  }
  if (["app.js", "firebase.js"].some(file => url.pathname.endsWith("/" + file))) {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(() => caches.match(request)));
    return;
  }
  if (SHELL_FILES.some(file => url.pathname.endsWith(file.replace(/^\.\//, "")))) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
  }
});
