---
name: khh-deploy
description: Deploy, operate and debug the KHH HRM attendance system (Klonghad Hospital) — Windows/PM2 production steps, PowerShell quirks, tis620 charset, migrations, backups, LINE/Telegram/LIFF setup, MFA lockout recovery. Use when the user pastes server output, asks how to deploy/push, or reports a production problem.
---

# KHH HRM — deploy & production runbook

Reply to the user in Thai. The user deploys by hand on the server; give commands one per line.

## Production facts
- Server: Windows, PowerShell, folder `D:\website\HOSPITAL-Attendence-V.3-main`
- PM2 app: `attendance-system` (only one — if `attendance-backend` appears, `pm2 delete attendance-backend`)
- PORT 3004 behind a proxy, public URL https://attendance.kittikhos.site (`SYSTEM_URL`)
- Backups: `D:\backup\khh-hrm` (`BACKUP_DIR`), 03:00 nightly, `BACKUP_HOSOFFICE_TABLES=hikvision`
- Two MySQL DBs on one server: `hospital_db` (this app, migrations 001–013 in `scripts/migrations.js`) and `hosoffice` (HOSoffice, read mostly; tis620 tables; the only write is INSERT into `hikvision` for accepted mobile scans; never UPDATE `is_notified` — dedupe is `notification_deliveries`)

## Standard deploy (give exactly this, adapted)
```powershell
cd D:\website\HOSPITAL-Attendence-V.3-main
git checkout -- public/css/erp.css
git pull origin main
npm install
npm run migrate
pm2 restart attendance-system --update-env
pm2 logs attendance-system --lines 30 --nostream
```
- Skip `npm install` / `migrate` when no package or migration changed; say which are needed.
- If incident rules changed: `node scripts/rebuild_incidents.js --from YYYY-MM --to YYYY-MM` (dry run), then add `--confirm`.
- Verify: `/health`, plus the page that changed.

## Quirks that bit us (check these first)
| Symptom | Cause / fix |
|---|---|
| `git pull` refuses: local changes to `public/css/erp.css` | Built on server — `git checkout -- public/css/erp.css` first |
| `&&` is not a valid statement separator | PowerShell 5 — one command per line |
| Script ignores `--confirm` etc. | npm strips flags in PowerShell — run `node scripts/x.js --flag` |
| Thai shows as `à¸...` / `????` | HOSoffice MySQL forces tis620 handshake; `forceUtf8mb4` in `src/config/db.js` runs `SET NAMES utf8mb4` on every connection — never remove it |
| Old CSS/JS after deploy | Proxy caches 4h; reference assets via `asset('/css/…')` (content hash), never a bare path |
| Backup error "สร้างโฟลเดอร์สำรองไม่ได้" | `BACKUP_DIR` points to a missing drive |
| LIFF page blank / "invalid" | `LIFF_ID` / `LINE_LOGIN_CHANNEL_ID` wrong channel; LIFF endpoint must be `https://<domain>/m/face` |
| Webhook returns 401 | Expected for unsigned requests; real LINE calls need correct `LINE_CHANNEL_SECRET` |
| Admin locked out of MFA | recovery code → another admin → last resort `ADMIN_MFA=off` + restart `--update-env`, then remove it |

## Rules to keep when changing code
- Never write `hosoffice.hr_person`. Read staff through `${STAFF}` (= `hospital_db.v_staff`, exported by `src/config/db.js`), never `FROM hr_person`. App-owned values: `app_accounts` / `staff_profiles` via `src/services/staffStore.js`, LINE/Telegram via `messagingLinks.js`. The view is rebuilt by every `npm run migrate`; if MySQL says v_staff doesn't exist, run migrate.
- LINE push quota 300/month: `LINE_PUSH_POLICY=important`; routine cards go to Telegram, chat answers use reply tokens.
- Approvals go through `src/services/reviewScope.js` (admins all, department heads own departments, never self).
- Face templates are AES-256-GCM with `FACE_TEMPLATE_KEY`; TOTP secrets derive from `SESSION_SECRET` — changing either breaks enrolled users.
- After editing views/Tailwind classes run `npm run build`; commit `public/css/erp.css`.
- Tests: `npm test` (unit) and `npm run test:integration` (local MySQL root, no password). Run both before committing.

## Git workflow
- Local dev is macOS; VS Code may auto-commit/push — check `git status`/`git log` before committing.
- Commit when work is done; **ask before `git push`** (user answers "push").
- Never echo tokens, secrets or `FACE_TEMPLATE_KEY`; if the user pastes one, tell them to reissue it.
