# Classroom demo guide

## Before the class

1. Start Docker Desktop, then in the repository root run `npm install`, `npm run setup:local`, and `npm run dev:lan`. The terminal prints the Mac’s current LAN URL. To find it manually on macOS, run `ipconfig getifaddr en0`.
2. Open the printed LAN URL in a normal browser window and an incognito/private window. Keep the terminal open. `localhost:5173` remains valid for a Mac-only rehearsal.
3. Confirm the login screen shows **DEMO ACCOUNTS**. If the demo has been altered, run `npm run demo:reset` and refresh both windows.

## Eight-step live demo

1. In Window 1 log in as **admin@queueless.local** / `Demo@12345`. In **Service sessions**, choose **Open Queue** for **Bonafide Certificate**. It is idempotent: a repeat click reports that the same operating-day queue is already open. Do not use a previous day’s historical queue.
2. In Window 2 log in as **staff@queueless.local** / `Demo@12345`. Bonafide now shows **OPEN** without a manual reload. Select it and point out the counter QR and its automatic expiry note.
3. On Android, open the same printed LAN URL and log in as **rahul@queueless.local** / `Demo@12345`. Join Bonafide Certificate. The actual server creates a unique token and the Mac queue table updates without a manual refresh.
4. When Rahul’s receipt says **Check-in required**, scan the staff screen QR with the Android Camera app. The signed URL opens on the phone; log in as Rahul if needed and tap **Confirm check-in**.
5. One-laptop fallback: staff can click **Copy demo proof**. If the HTTP LAN browser blocks clipboard access, select the displayed demo-only proof field, then paste it into Rahul’s authenticated check-in page. This calls the exact same signed server endpoint as a phone scan.
6. Show Rahul change to **Checked in** on both devices. Staff clicks **Call next verified token**, then **Start service**, then **Complete**. The token history and admin metrics update.
7. For the accelerated no-show scenario, create a fourth token in the same open queue (the normal policy opens check-in for the first three). Use Anaya, Rahul, and Priya plus one temporary registered student if needed. The fourth token remains **Waiting**; select **Open demo no-show window** in Admin. The scheduler—not a browser timer—marks that waiting token **No show** after the displayed 35-second demo grace period.
8. In Admin, point out the current operating-day totals, completed history, and the queue-session audit row. Previous-day records remain visible in the audit database but do not affect today’s open-queue count.

## Reset and recovery

- A token already active: use a different seeded student or reset with `npm run demo:reset`.
- A token created before the QR timing fix is deliberately left unchanged. To demonstrate the new 15-minute normal check-in window without resetting data, cancel only that student's active waiting/check-in token from the student portal, then join the service again. The newly issued token receives the current window. Alternatively, use an unused seeded student.
- QR expired: wait for the staff QR to rotate (or click its refresh button) and scan/copy the new one.
- `Awaiting check-in`: staff cannot call a waiting token by design; check in first.
- Browser session confused: sign out and use the intended account in a separate private context.
- Docker was stopped: run `npm run db:up`, `npm run db:migrate`, and `npm run db:seed`, then restart `npm run dev`.
- If every service is **Closed** after midnight, this is the intentional manual-session policy: sign in as Admin and use **Open Queue** for today. Opening never revives a historical session. Closing a queue cancels pending unserved tokens with an audit reason and refuses to interrupt a called/in-service token.

## Phone presentation (including an Android personal hotspot)

1. Connect both devices to the same Wi-Fi network or Android personal hotspot.
2. From the repository root, run `npm run dev:lan` and read the LAN URL printed by the command.
3. Open that exact URL on both devices; use the Mac browser for staff and the phone browser for the student. The API also accepts `localhost:5173` for a Mac-only development session, but do not use a stale hotspot IP.
4. Generate a fresh staff QR on the Mac and scan it with the phone.

`dev:lan` binds Vite to all interfaces, proxies REST and Socket.IO as same-origin paths, and supplies the public QR base URL to the API. If the hotspot assigns the Mac a different address, restart with `QUEUELESS_LAN_IP=NEW_MAC_IP npm run dev:lan`. Allow the macOS Node firewall prompt if it appears. Use a current QR only; screenshots are not treated as permanent physical proof.
