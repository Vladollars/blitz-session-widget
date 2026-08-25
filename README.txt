WEB v0.1.1 OBSERVABILITY

Upload to the GitHub Pages repository root:
- index.html
- summary.html
- tanks.html
- style.css
- config.js
- frontend.js
- admin.html   (new)

Platform detection:
- automatic from the WebView/browser environment
- values: windows / android / ios / macos / linux / unknown

IMPORTANT:
Steam vs WGC vs Microsoft Store is NOT guessed.
The same Windows DAVA WebView does not reliably expose which launcher/store started Blitz.
For now distribution is recorded as "unknown".
This is intentional rather than collecting made-up data.

Admin page:
https://vladollars.github.io/blitz-session-widget/admin.html
It asks for ADMIN_TOKEN and sends it only in the Authorization header.
The token is kept in sessionStorage, not committed to GitHub.
