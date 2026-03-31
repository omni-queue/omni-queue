// dashboard-config.example.js
//
// Inject this <script> block into the HTML page that hosts the Omni Queue
// dashboard (e.g. app.html, _document.tsx, layout.ejs) BEFORE the dashboard
// JS bundle tag.  All keys are optional — omit any you do not need to override.
//
// window.__OMNI_QUEUE_DASHBOARD_CONFIG__ = {
//
//   // transport
//   // ─────────────────────────────────────────────────────────────────────
//   // Controls the real-time data transport used by the dashboard.
//   //   'auto'    — try WebSocket first, fall back to long-polling (default)
//   //   'polling' — force long-polling only
//   //                (use this when WebSocket upgrades are blocked by a
//   //                 proxy, CDN, serverless platform, or load balancer)
//   //
//   // Can also be set per-page-load via URL query param:  ?transport=polling
//   // Build-time env var (local dev only):  VITE_DASHBOARD_TRANSPORT=polling
//   //
//   transport: 'auto',
//
//   // endpoint
//   // ─────────────────────────────────────────────────────────────────────
//   // The API base URL the dashboard uses to reach the Omni Queue API.
//   // Must match the `apiBase` option you passed to your framework adapter.
//   //
//   // Build-time env var (local dev only):  VITE_DASHBOARD_ENDPOINT=/api/omni-queue
//   //
//   // Default: '/api/dashboard'
//   //
//   endpoint: '/api/dashboard',
//
// };
