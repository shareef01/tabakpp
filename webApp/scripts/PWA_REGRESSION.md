# Production PWA navigation regression

Run `npm run test:pwa` after `npm ci`, using Node 22.23.2/npm 10.9.8 and
an installed Chromium (`PUPPETEER_EXECUTABLE_PATH` can select it). General CI
runs this gate with its preinstalled Chrome; no additional browser dependency
or browser download is required.

The test builds the real application twice, serves production output with the
Firebase Hosting SPA rewrite, and uses fresh browser contexts. It waits for
service-worker control before navigating offline. Both Chromium's offline
mode and disabled server responses enforce loss of connectivity. Assertions
inspect actual document responses and rendered sign-in UI, including unvisited
`/history` and `/settings` paths, rather than accepting previously rendered DOM.

Build B must arrive online while the A worker is active. The normal autoUpdate
flow must activate B, remove A's precache entries, and serve B offline without
a reload loop. API/auth paths must never receive the offline shell. Cache
contents and worker/browser errors are checked, including a 390×844 viewport.
This covers Chromium, not a new Firefox/WebKit matrix or authenticated data.

The fixture uses non-secret Firebase client configuration and never signs in
or mocks backend responses. Only cosmetic Google Fonts CSS is intercepted.
The existing missing-App-Check-site-key diagnostic is recorded and expected
for this fixture; enforcement/settings remain untouched.

The navigation strategy tries the network and uses a revisioned
`offline-shell.html` precache snapshot only when the fetch fails. Ordinary
`index.html` is not precached. There is no per-URL runtime HTML cache, so unseen
routes work offline and old page HTML cannot outlive its associated precache.
Workbox generateSW's built-in PrecacheFallbackPlugin provides this behavior.
It does not impose the former four-second NetworkFirst timeout: a stalled
network falls back when the browser fetch fails. HTTP error responses remain
network responses. Static assets retain their existing bounded cache policy.

Set `PWA_TEST_REPORT` to retain JSON evidence outside the temporary directory.
Failed runs retain their build logs and output; `PWA_TEST_KEEP_OUTPUT=1` also
retains successful output and the mobile screenshot. The local rewrite server
models the checked-in Firebase Hosting configuration; it is not a live deploy.

Issue: https://github.com/shareef01/tabakpp/issues/80
Workbox: https://developer.chrome.com/docs/workbox/modules/workbox-build
Routing: https://developer.chrome.com/docs/workbox/modules/workbox-routing
