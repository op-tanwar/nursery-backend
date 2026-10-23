# Urban Nursery Backend

REST API for **Urban Nursery**, a multi-vendor plant nursery e-commerce platform. The backend powers customer shopping, nursery vendor dashboards, admin operations, payments, and content marketing.

---

## Project Overview

Urban Nursery Backend is a Node.js / Express 5 / TypeScript API backed by MongoDB (Mongoose 9). It supports a marketplace where multiple nurseries list plants, pots, and gardening accessories; customers browse, cart, checkout via Razorpay, and track orders; admins manage users, vendors, coupons, and analytics.

The API is versioned under `/api/v1` and is designed to pair with a separate frontend (e.g. Next.js on Vercel) deployed on platforms such as Render.

---

## Features

### Customer
- User registration, login, profile management, and password recovery
- Browse plants, pots, and accessories with search, filter, and pagination
- Product reviews and ratings (1–5)
- Cart and wishlist with guest-to-authenticated sync
- Coupon validation at checkout
- Razorpay payment integration with webhook-based order finalization
- Order history, tracking, and replacement/refund claims (with photo/video proof upload)

### Nursery (Vendor)
- Nursery onboarding application workflow (pending admin approval)
- Dashboard login with separate dashboard password
- CRUD for plants, pots, and accessories with Cloudinary image uploads (approved nurseries only)
- Vendor-specific order management and status updates
- Nursery dashboard analytics (earnings, orders, low-stock alerts)

### Admin
- User and nursery management
- Nursery application review (approve / reject)
- Global order management with pagination
- Coupon validation endpoint (admin CRUD for coupons can be added)
- Platform-wide analytics dashboards
- Newsletter subscriber management
- Blog content moderation

### Marketing & Content
- Blog posts with slug-based URLs and view counters
- Newsletter subscribe / unsubscribe (HMAC-secured unsubscribe tokens)
- Automated email notifications (orders, claims, blog broadcasts)

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 18+ |
| Language | TypeScript |
| Framework | Express 5 |
| Database | MongoDB (Mongoose 9) |
| Authentication | JWT (httpOnly cookies; Bearer header supported) |
| File uploads | express-fileupload + Cloudinary |
| Payments | Razorpay (server-side price computation + webhook verification) |
| Email | Nodemailer (unified `EMAIL_*` SMTP config) |
| Security | bcryptjs, helmet, express-rate-limit, CORS |
| Performance | compression middleware |
| Dev tooling | ts-node-dev |

---

## Installation

### Prerequisites

- Node.js 18+ recommended
- MongoDB instance (local or Atlas)
- Cloudinary account
- Razorpay account (for payments)
- SMTP credentials (for transactional email)

### Steps

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd planto-bankend
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment variables**

   Create `.env` in the project root (see [Environment Variables](#environment-variables) below). Copy `.env.example` as a starting point.

4. **Run in development**

   ```bash
   npm run dev
   ```

5. **Build and run in production**

   ```bash
   npm run build
   npm start
   ```

The server starts on `http://localhost:4000` by default (or the port set in `PORT`).

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: `4000`) |
| `NODE_ENV` | No | `development` or `production` |
| `DB_URI` | **Yes** | MongoDB connection string |
| `JWT_SECRET` | **Yes** | Secret for signing JWT tokens |
| `JWT_EXPIRES_TIME` | No | Token expiry (default: `7d`) |
| `COOKIE_EXPIRES_TIME` | No | Cookie expiry in days (default: `7`) |
| `FRONTEND_URL` | **Yes** | Frontend origin for CORS and email links |
| `CLOUDINARY_NAME` | **Yes** | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | **Yes** | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | **Yes** | Cloudinary API secret |
| `RAZORPAY_KEY_ID` | **Yes** | Razorpay key ID |
| `RAZORPAY_KEY_SECRET` | **Yes** | Razorpay key secret |
| `RAZORPAY_WEBHOOK_SECRET` | **Yes** | Razorpay webhook signature secret |
| `EMAIL_HOST` | **Yes** | SMTP host (transactional + blog broadcast) |
| `EMAIL_PORT` | No | SMTP port (default: `587`) |
| `EMAIL_SECURE` | No | `true` for port 465 |
| `EMAIL_USER` | **Yes** | SMTP username |
| `EMAIL_PASSWORD` | **Yes** | SMTP password |
| `EMAIL_FROM_NAME` | No | Sender display name (default: `Urban Nursery Support`) |
| `ADMIN_EMAIL` | No | Admin email for claim alerts |
| `NURSERY_SERVICE_RADIUS_KM` | No | Nursery service radius in km (default: `12`) |

> **Note:** `.env` is gitignored. Use `.env.example` as a template. Never commit secrets to version control.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with ts-node-dev |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled production build |

---

## Project Structure

```
planto-bankend/
├── .env                    # Local environment variables (gitignored)
├── .env.example            # Environment template for Git
├── src/
│   ├── app.ts              # Express app, middleware, route mounting
│   ├── server.ts           # Entry point, DB connect, graceful shutdown
│   ├── controllers/        # Request handlers
│   ├── database/
│   │   └── database.ts     # MongoDB connection
│   ├── middleware/
│   │   ├── auth.ts         # JWT auth & role authorization
│   │   ├── catchAsyncErrors.ts
│   │   ├── error.ts        # Global error handler
│   │   └── fileValidate.ts # Route-scoped upload validation
│   ├── models/             # Mongoose schemas
│   ├── routes/             # Express route definitions
│   ├── types/              # TypeScript interfaces
│   └── utils/              # Helpers (JWT, email, API features)
├── .env.example            # Environment variable template
├── dist/                   # Compiled output (generated)
├── package.json
├── tsconfig.json
└── nodemon.json
```

### API Route Map (`/api/v1`)

| Prefix | Module |
|--------|--------|
| `/plants` | Plant catalog, reviews, nursery plant management |
| `/pots` | Pots catalog and nursery management |
| `/accessories` | Accessories catalog and nursery management |
| `/users` | Auth, profiles, admin user management |
| `/orders` | Orders, claims, nursery/admin order management |
| `/nursery-profile` | Vendor onboarding and profiles |
| `/payment` | Razorpay order creation and webhooks |
| `/marketing` | Blog posts |
| `/newsletter` | Newsletter subscriptions |
| `/shop` | Cart and wishlist |
| `/dashboard` | Admin and nursery analytics dashboards |
| `/promotions` | Coupon validation |

### Health Check

```
GET /health
```

Returns `200` with `{ status: "UP", database: "CONNECTED" }` when MongoDB is connected, or `503` when the database is unavailable. Use for load balancer and orchestrator readiness probes.

---

## Deployment

### Recommended: Render + MongoDB Atlas + Vercel Frontend

1. **Database:** Provision MongoDB Atlas and set `DB_URI`.
2. **Backend (Render):**
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
   - `trust proxy` is configured in `app.ts`.
   - Add all environment variables in the Render dashboard.
3. **Frontend:** Deploy separately and set `FRONTEND_URL` to the production frontend URL (no trailing slash).
4. **Razorpay:** Configure webhook URL to `https://<your-api>/api/v1/payment/webhook`.
5. **Cloudinary:** Ensure upload folders exist (`plants/`, `pots/`, `accessories/`, `avatars/`, `urban_nursery_claims/`).

### Production Checklist

- Set `NODE_ENV=production`
- Use strong `JWT_SECRET` and `RAZORPAY_WEBHOOK_SECRET`
- Restrict CORS `FRONTEND_URL` to your real domain
- Enable MongoDB IP allowlisting
- Point health checks to `GET /health`
- Monitor logs for unhandled rejections (server auto-exits on critical errors)
- Server handles `SIGTERM` / `SIGINT` with graceful HTTP and MongoDB shutdown

---

## Security Features

Already implemented:

- **Helmet** — HTTP security headers
- **CORS** — Single-origin with credentials
- **Rate limiting** — 30 req/15 min on login/register/forgot-password; 500 req/15 min on `/api/v1` (webhook exempt)
- **Privileged auth hardening** — Dedicated limiter coverage for `/users/nursery-login` and `/users/admin-login`
- **JWT** — httpOnly cookies; token not returned in login response body
- **Token revocation** — Logout revocation store enforced in auth middleware
- **CSRF mitigation** — Origin/Referer guard for state-changing cookie-authenticated requests
- **Password hashing** — bcryptjs with separate dashboard passwords
- **Payment** — Server-side price computation; Razorpay signature verification; webhook amount cross-check
- **NoSQL injection mitigation** — Operator stripping in `ApiFeatures`; optional field whitelisting
- **File upload validation** — MIME and extension checks; route-scoped video allowance for claims
- **Account status** — `isActive`, `isBlocked`, `status` enforced in auth middleware
- **Production errors** — Stack traces hidden when `NODE_ENV=production`

---

## Performance Optimizations

- **Server-side pagination** via `ApiFeatures` and dedicated paginated admin/user order endpoints
- **Filtered count queries** using `countDocuments`
- **MongoDB indexes** on orders, users, products, and unique `paymentInfo.id`
- **Text indexes** on plant, pot, and accessory names/categories
- **Aggregation pipelines** for nursery and admin dashboard analytics
- **Parallel Cloudinary uploads** with `Promise.all`
- **Atomic stock updates** with conditional `$inc`
- **In-memory nursery ID cache** (5-minute TTL) for catalog queries
- **Response compression** via `compression` middleware
- **Background email sending** (non-blocking after order/blog events)
- **Blog newsletter batching** via MongoDB cursor (100 recipients per batch)

---

## Future Improvements

- Integrate coupon redemption into Razorpay order creation and persist `usedBy` on checkout
- Add Zod or Joi validation on all endpoints
- Add admin CRUD routes for coupons
- Add automated test suite (unit + integration)
- Add OpenAPI / Swagger documentation
- Add Redis caching for catalog and token blacklist
- Add structured logging (Winston / Pino)
- Externalize product reviews into a separate collection

---

## License

ISC

---

## Author

Urban Nursery Team
