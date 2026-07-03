RUN

npm run dev

npm run api:dev



Desktop app (Electron)

npm run electron:start



Windows installer

rmdir /s /q dist-electron - remove old build

npm run electron:dist - build a new one





*** Office LAN (netgear35)

NAS: \\192.168.1.155\home



*** Remote via Tailscale

1. Connect Tailscale before starting the app

2. DATABASE_URL host: 100.68.127.126 (port 5433)

3. Image uploads use local `uploads/` folder (NAS share is LAN-only)

4. To force NAS uploads over VPN, set UPLOADS_DIR_FORCE=true in .env



Test DB: Test-NetConnection 100.68.127.126 -Port 5433

*** automatically update steps
- npm run electron:dist
- http://192.168.1.155:5000/web/updates/custom-quote/
    add: latest.yml
    add: Custom Quote Setup 1.0.2{here_your_new_version}.exe
    add: Custom Quote Setup 1.0.2{here_your_new_version}.exe.blockmap