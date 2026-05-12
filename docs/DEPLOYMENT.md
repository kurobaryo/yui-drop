# Deployment

This doc covers production deployment. For local dev, see the [Quick start](../README.md#quick-start) section of the main README.

## Recommended topology

```
            Internet
                │
                ▼
   ┌─────────────────────────┐
   │   Cloudflare (orange)   │   ← TLS termination, WAF, bot fight, caching off for /api/*
   └─────────────┬───────────┘
                 │
                 ▼
   ┌─────────────────────────┐
   │   Reverse proxy / NPM   │   ← Let's Encrypt cert via DNS-01
   │   (Caddy or Nginx)      │
   └─────────────┬───────────┘
                 │
                 ▼ http://yui-drop:8000
   ┌─────────────────────────┐
   │  Docker: yui-drop       │
   └─────────────────────────┘
```

## Cloudflare-proxied (orange cloud) HTTPS

1. Point your domain (e.g. `drop.leod.me`) at the host's IP via Cloudflare (proxy "orange").
2. On the host install [Nginx Proxy Manager](https://nginxproxymanager.com/) or Caddy.
3. Issue a Let's Encrypt cert using **DNS-01** challenge (HTTP-01 fails behind Cloudflare's proxy — see `cloudflare-proxy-with-le-via-npm` skill for setup details).
4. Proxy the hostname → `http://yui-drop:8000`.
5. In `.env` set `APP_URL=https://drop.leod.me` and `ALLOWED_ORIGINS=https://drop.leod.me`. Restart.

## Configuring Cloudflare R2

1. Create an R2 bucket (e.g. `yui-drop-prod`).
2. Generate an API token scoped to that bucket only (Object Read & Write).
3. Set the following in `.env`:

   ```
   STORAGE_BACKEND=s3
   S3_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
   S3_BUCKET_NAME=yui-drop-prod
   S3_ACCESS_KEY_ID=<token's access key>
   S3_SECRET_ACCESS_KEY=<token's secret>
   S3_REGION_NAME=auto
   ```

4. (Optional) Attach a custom domain to the bucket (e.g. `cdn.drop.leod.me`) and set `S3_PUBLIC_HOSTNAME=cdn.drop.leod.me` so download links use that domain instead of the R2 raw endpoint.
5. Configure CORS on the bucket so the browser can `PUT` parts directly:

   ```json
   [
     {
       "AllowedOrigins": ["https://drop.leod.me"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

6. Restart: `docker compose up -d --build`.

## Backups

- **DB** (`/app/data/yui-drop.db` inside the container, `yui-drop-data` Docker volume on the host): back up daily. The container ships a script you can wire to cron:

  ```bash
  docker exec yui-drop sqlite3 /app/data/yui-drop.db ".backup '/app/data/backups/$(date +%F).db'"
  ```

- **Bucket**: R2 has its own durability story; for extra safety, set up cross-region replication or an offsite copy.

## Updating

```bash
cd yui-drop
git pull
docker compose up -d --build
```

Migrations run automatically on container startup (Alembic `upgrade head`).

## Operational notes

- **CORS**: in production, set `ALLOWED_ORIGINS` to your exact deploy URL. Never `*`.
- **Trusted proxies**: the container runs Uvicorn with `--proxy-headers --forwarded-allow-ips=*`. If you put it behind a CDN, configure `X-Forwarded-For` so per-IP rate limiting sees the real client.
- **Disable directory listing**: not applicable; the API only serves files for a valid `code+key`.
- **Health probe**: `GET /api/health` → 200 OK.

## Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| Browser uploads fail with CORS errors when using R2 | The bucket's CORS policy doesn't include your deploy URL. Add it (see above). |
| Large files time out partway through | Increase your reverse proxy's `client_max_body_size` / `proxy_request_buffering off`. But the recommended fix is to use the S3 multipart path (which streams directly to the bucket, not through your proxy). |
| Admin token doesn't work | The `.env` value was overridden by an admin-set password. Use the password from `/admin/settings`, or wipe `data/yui-drop.db` to reset. |
| `prefers-color-scheme` doesn't change theme | The mode picker is set to "Light" or "Dark"; switch back to "System". |
