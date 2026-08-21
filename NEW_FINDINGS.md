# NEW_FINDINGS.md — Production Hardening Sprint 1

> Generated: 2026-08-19

---

## 1. CREDENTIALS EXPOSED — ROTATION REQUIRED

- **Severity**: HIGH
- **File**: `seed.js`, `log.md`, prior reports
- **Location**: `seed.js:11,29,48,64,80` — demo store passwords in plaintext
- **Problem**: Demo account credentials (baghdadscents, techhub, watchstyle, luxbags, goldencare) exist in seed.js and were referenced in prior reports. These are effectively compromised.
- **Impact**: Anyone with access to the repo/reports can log in as these demo merchants or admin.
- **Recommendation**: Rotate ALL demo credentials before public launch. Consider making seed.js non-functional in production (check `NODE_ENV` before seeding).

---

## 2. In-Memory Rate Limiter Not Shared Across Workers

- **Severity**: MEDIUM
- **File**: `util.js:111-122`
- **Location**: `ipLimits` and `loginLocks` are `Map()` objects in process memory
- **Problem**: PM2 runs in cluster mode with `instances: 1`, so currently fine. But if instances > 1, each worker has its own rate limit map — attacker can bypass by hitting different workers.
- **Impact**: Rate limits become per-worker instead of per-server when scaling.
- **Recommendation**: For single-instance deployment (current), this is acceptable. For future multi-instance, consider Redis-backed rate limiting or PM2 sticky sessions.

---

## 3. Session Store Is In-Memory

- **Severity**: MEDIUM
- **File**: `db.js` — sessions table exists but `currentUser()` queries it on every request
- **Location**: `util.js:63-71`
- **Problem**: Sessions are stored in SQLite (not in-memory), which is good. But session cleanup only runs on `currentUser()` calls — orphaned sessions from crashed processes won't be cleaned until accessed.
- **Impact**: Minor — stale sessions occupy negligible space.
- **Recommendation**: Already acceptable. Daily WAL checkpoint handles most cleanup.

---

## 4. CORS Not Configured

- **Severity**: LOW
- **File**: `server.js`
- **Location**: No CORS middleware present
- **Problem**: API endpoints (e.g., `/s/:slug/coupon-check`, `/panel/api/*`) have no CORS headers. This is fine for same-origin usage but blocks legitimate cross-origin requests (e.g., mobile app, embedded widgets).
- **Impact**: Not a security issue — just a functionality gap for future integrations.
- **Recommendation**: Add CORS only when cross-origin access is actually needed.

---

## 5. No HTTPS Redirect Middleware

- **Severity**: LOW (production concern)
- **File**: `server.js`
- **Location**: No HTTP→HTTPS redirect
- **Problem**: When deployed behind a reverse proxy with HTTPS, the app doesn't redirect HTTP to HTTPS. Relies on the reverse proxy to handle this.
- **Impact**: Users could access the site over HTTP if proxy misconfigured.
- **Recommendation**: Add HTTPS redirect middleware when deploying with a reverse proxy. Not needed for localhost development.

---

## 6. Trust Proxy = 1 Without Verification

- **Severity**: LOW
- **File**: `ecosystem.config.js:12`, `server.js:11`
- **Location**: `TRUST_PROXY: '1'` in PM2 config
- **Problem**: `trust proxy` is set to 1, which means Express trusts the first proxy. If deployed without a real reverse proxy (e.g., direct to internet), IP-based rate limiting can be bypassed via `X-Forwarded-For` header.
- **Impact**: Rate limit bypass if no real reverse proxy is in front.
- **Recommendation**: Document that deployment MUST use a reverse proxy (nginx/cloudflare) when `TRUST_PROXY=1`. Or set to `false` for direct connections.

---

## 7. Shipping Label Generates Placeholder Error

- **Severity**: LOW
- **File**: `shipping.js:325-332`
- **Location**: `generateShippingLabel()` function
- **Problem**: Now throws an error instead of returning a fake PDF. The user sees "فشل إنشاء البوليصة" which is correct but could be more informative.
- **Impact**: Users cannot download shipping labels (was already non-functional).
- **Recommendation**: When real PDF generation is implemented, replace the throw with actual generation.

---

## 8. Coupon Not Reverted on ZainCash Expiry

- **Severity**: LOW
- **File**: `routes/store.js:150`
- **Location**: `db.prepare('UPDATE coupons SET used = used + 1 WHERE id=?').run(c.id)`
- **Problem**: Coupon `used` count is incremented when order is created. If ZainCash payment expires (15 min timeout), the coupon usage is not reverted.
- **Impact**: A coupon could be "used up" by abandoned orders. Minor at current scale.
- **Recommendation**: Revert coupon usage in `cancelExpiredPendingOrders()` if coupon was applied.

---

## 9. Loyalty Points Not Reverted on ZainCash Expiry

- **Severity**: LOW
- **File**: `routes/store.js:220`
- **Location**: `addLoyaltyPoints(store.id, customer_phone, earnedPoints, 'order', orderId, ...)`
- **Problem**: Loyalty points are added when order is created. If ZainCash payment expires, points are not reverted.
- **Impact**: Customer earns points without completing purchase. Minor at current scale.
- **Recommendation**: Revert loyalty points in `cancelExpiredPendingOrders()`.

---

## 10. multer File Filter Allows Only Image Extensions

- **Severity**: INFO
- **File**: `routes/panel.js:33-34`
- **Location**: `fileFilter` in multer config
- **Problem**: File filter checks extension only, not content. But `isRealImage()` function checks magic bytes before processing. This is defense-in-depth and works correctly.
- **Impact**: Non-image files with image extensions will be accepted by multer but rejected by `isRealImage()`.
- **Recommendation**: No action needed — current defense-in-depth is sufficient.
