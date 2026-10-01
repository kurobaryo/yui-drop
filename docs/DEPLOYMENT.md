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

1. Point your domain (e.g. `drop.example.com`) at the host's IP via Cloudflare (proxy "orange").
2. On the host install [Nginx Proxy Manager](https://nginxproxymanager.com/) or Caddy.
3. Issue a Let's Encrypt cert using **DNS-01** challenge (HTTP-01 fails behind Cloudflare's proxy — see `cloudflare-proxy-with-le-via-npm` skill for setup details).
4. Proxy the hostname → `http://yui-drop:8000`.
5. In `.env` set `APP_URL=https://drop.example.com` and `ALLOWED_ORIGINS=https://drop.example.com`. Restart.

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

4. (Optional) Attach a custom domain to the bucket (e.g. `cdn.drop.example.com`) and set `S3_PUBLIC_HOSTNAME=cdn.drop.example.com` so download links use that domain instead of the R2 raw endpoint.
5. Configure CORS on the bucket so the browser can `PUT` parts directly:

   ```json
   [
     {
       "AllowedOrigins": ["https://drop.example.com"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

6. Restart: `docker compose up -d --build`.

### Runtime storage switch (admin UI)

The admin Settings page also lets the maintainer reconfigure storage at runtime without editing `.env`:

- Navigate to `/admin/settings → Storage backend`.
- Pick `S3 (Cloudflare R2 etc.)`, fill in endpoint/bucket/keys, and submit **Save and test connectivity**.
- The backend will `head_bucket` the target before persisting — if it fails, the form returns a 422 and nothing is written.
- The secret access key is AES-GCM encrypted (key from `SECRETS_KEY`) before it lands in `settings_kv`. The wire never sees the plaintext after save; `GET /api/admin/storage` always masks it as `****`.

**SECRETS_KEY**: a base64url-encoded 32-byte value. The app refuses to start if it's empty. Generate one with:

```bash
python -c "import secrets, base64; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
```

**Existing files are not migrated when you switch backends.** Rows already in `filecodes` keep their `file_path` pointing at the original location (e.g. local disk) and will continue to serve from there. Only **new uploads** land on the newly selected backend. No migration script ships in this iteration.

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
- **Client IP and trusted proxies**: rate limits, pickup-code bans and access logs use the client IP, read from `CF-Connecting-IP`, then `X-Forwarded-For`, then `X-Real-IP`. The app trusts these headers, so **the reverse proxy must overwrite them**, and when you sit behind Cloudflare it must only accept them from Cloudflare's edge ranges. Otherwise anyone who reaches the origin directly can spoof their IP and dodge the limits. An nginx example:

  ```nginx
  # one line per range from https://www.cloudflare.com/ips-v4 and /ips-v6
  set_real_ip_from 173.245.48.0/20;
  # ...
  real_ip_header CF-Connecting-IP;

  location / {
      proxy_pass http://127.0.0.1:8000;
      proxy_set_header CF-Connecting-IP $remote_addr;
      proxy_set_header X-Forwarded-For  $remote_addr;
      proxy_set_header X-Real-IP        $remote_addr;
  }
  ```

  Better still, firewall the origin so only Cloudflare can reach ports 80/443.
- **Disable directory listing**: not applicable; the API only serves files for a valid `code+key`.
- **Health probe**: `GET /api/health` → 200 OK.

## Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| Browser uploads fail with CORS errors when using R2 | The bucket's CORS policy doesn't include your deploy URL. Add it (see above). |
| Large files time out partway through | Increase your reverse proxy's `client_max_body_size` / `proxy_request_buffering off`. But the recommended fix is to use the S3 multipart path (which streams directly to the bucket, not through your proxy). |
| Admin token doesn't work | The `.env` value was overridden by an admin-set password. Use the password from `/admin/settings`, or wipe `data/yui-drop.db` to reset. |
| `prefers-color-scheme` doesn't change theme | The mode picker is set to "Light" or "Dark"; switch back to "System". |
