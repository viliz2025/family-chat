# Family Chat Media Worker

Cloudflare Worker for private family-chat photo uploads and reads through R2.

## Setup

1. Create a Cloudflare account.
2. Create an R2 bucket named `family-chat-photos`.
3. Install dependencies:

```bash
npm install
```

4. Copy `.dev.vars.example` to `.dev.vars` for local development and fill values.
5. Run locally:

```bash
npm run dev
```

6. Configure Worker secrets:

```bash
npx wrangler secret put MEDIA_TOKEN_SECRET
npx wrangler secret put ALLOWED_ORIGIN
```

`MEDIA_TOKEN_SECRET` must match the `MEDIA_TOKEN_SECRET` in the main Next.js app. `ALLOWED_ORIGIN` should be the deployed chat origin, for example `https://your-chat.vercel.app`.

7. Deploy:

```bash
npm run deploy
```

8. In the main Vercel app, set:

```bash
MEDIA_PROXY_BASE_URL=https://family-chat-media.<account>.workers.dev
NEXT_PUBLIC_MEDIA_UPLOAD_URL=https://family-chat-media.<account>.workers.dev/upload
MEDIA_TOKEN_SECRET=<same secret as Worker>
```

9. Redeploy the Vercel app after changing env vars.

The R2 bucket should stay private. The Worker serves files only with short-lived HMAC tokens issued by the main app after its session and message checks.
