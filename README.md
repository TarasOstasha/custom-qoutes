# Custom Quote

Desktop quoting app (Next.js + Express + Electron).

## Development

```bash
npm run dev
npm run api:dev
```

## Desktop app (Electron)

```bash
npm run electron:start
```

## Windows installer

```bash
rmdir /s /q dist-electron
npm run electron:dist
```

## Releasing updates

1. Bump `version` in `package.json` (e.g. `1.0.0` → `1.0.1`).
2. Build the installer:

   ```bash
   npm run electron:dist
   ```

3. Upload the contents of `dist-electron/` to the update server folder:
   - Default URL: `http://100.68.127.126/updates/custom-quote/`
   - Required files: `latest.yml`, the `.exe` installer, and `.blockmap` files (for differential updates).

4. Installed apps check for updates 5–10 seconds after launch and show an in-app update badge when a newer version is available.

### Update server URL

Override the default NAS Tailscale URL by setting in `.env`:

```env
UPDATE_SERVER_URL=http://100.68.127.126/updates/custom-quote/
```

(`ELECTRON_UPDATE_URL` is also supported.)

## Office LAN (netgear35)

NAS: `\\192.168.1.155\home`

## Remote via Tailscale

1. Connect Tailscale before starting the app.
2. `DATABASE_URL` host: `100.68.127.126` (port `5433`).
3. Image uploads use local `uploads/` folder (NAS share is LAN-only).
4. To force NAS uploads over VPN, set `UPLOADS_DIR_FORCE=true` in `.env`.

Test DB: `Test-NetConnection 100.68.127.126 -Port 5433`
