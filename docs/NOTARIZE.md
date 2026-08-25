# How to certify the DMG (Apple notarization)

The DMG is already **signed** with your Developer ID certificate
(`Developer ID Application: Jiahe Tian (4QUC4B3L36)`, in your login Keychain).
"Certifying" it means **notarization**: submitting the build to Apple's notary
service, which scans it and issues a ticket that gets stapled to the DMG.
After that, Gatekeeper opens it on any Mac with no "cannot verify" warning.

Follow these steps in order. Step 1 is the only thing that must be done by a
human in a browser — everything after it is scripted.

---

## Step 1 — Create an app-specific password (one time, ~2 minutes)

1. Open https://account.apple.com and sign in with the Apple ID that owns the
   developer account (the one enrolled in the Apple Developer Program for team
   `4QUC4B3L36`).
2. Go to **Sign-In and Security → App-Specific Passwords**.
3. Click **+**, name it something like `goose-notarize`, and copy the
   generated password. It looks like `abcd-efgh-ijkl-mnop`.

Notes:
- This is **not** your Apple ID password. Notary tooling is not allowed to use
  your real password; this scoped one is revocable anytime from the same page.
- If the page asks, you may need two-factor authentication enabled first.

## Step 2 — Store the credentials in the Keychain (one time)

Run this once, substituting your Apple ID email and the password from Step 1:

```sh
xcrun notarytool store-credentials goose-notary \
  --apple-id "YOUR_APPLE_ID@example.com" \
  --team-id 4QUC4B3L36 \
  --password "abcd-efgh-ijkl-mnop"
```

This saves a Keychain profile named `goose-notary` so the password never has
to appear in a shell command or env var again.

## Step 3 — Build config (already done)

`package.json` has `"notarize": true` under `build.mac`, and the `dist` /
`dist:mac` npm scripts set `APPLE_KEYCHAIN_PROFILE=goose-notary` so the
credentials come straight from the Keychain profile of Step 2.

⚠️ electron-builder treats `notarize: true` as *best-effort*: if it finds no
credentials (env vars or keychain profile) it logs a one-line warning,
**skips notarization, and still exits 0**. That is why the profile is baked
into the npm scripts — always build through them, never bare
`npx electron-builder --mac`, or you can ship an un-notarized DMG without
noticing. Always run the Step 5 check before uploading.

## Step 4 — Build a notarized release

From the project root:

```sh
npm run dist:mac
```

That's it — no env exports needed. electron-builder signs, uploads to Apple,
waits for the verdict (usually 2–10 minutes; first submission can take
longer), and staples the ticket to the `.app`. If the build hangs at
"notarizing", that is normal — it is waiting on Apple.

(Alternative without the keychain profile: export `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID=4QUC4B3L36` and run
`npx electron-builder --mac`.)

## Step 5 — Verify before shipping

Validate the **.app**, not the DMG — electron-builder staples the ticket to
the app bundle inside; the DMG container itself is intentionally left
unsigned/unstapled (Gatekeeper checks the app, and this keeps the DMG bytes
identical to what latest-mac.yml hashed for auto-update):

```sh
xcrun stapler validate "release/mac-arm64/Entitled Goose.app"
spctl -a -vv "release/mac-arm64/Entitled Goose.app"
```

Expected: `The validate action worked!` and `accepted` with
`source=Notarized Developer ID`. (x64 build lives in `release/mac/`.)
Running `stapler validate` on the `.dmg` file will report error 65 — that is
expected, not a failure. Only upload artifacts to the GitHub release after
both `.app` checks pass.

## Troubleshooting

- **`Invalid credentials` / 401** — the app-specific password was mistyped or
  revoked, or the Apple ID isn't the one enrolled in team `4QUC4B3L36`.
- **`You must first sign the relevant contracts online`** — log in at
  https://developer.apple.com/account and accept the pending agreement.
- **Status `Invalid` from the notary service** — get the log:
  `xcrun notarytool log <submission-id> --keychain-profile goose-notary`.
  The usual cause is a binary signed without the hardened runtime;
  electron-builder enables it by default, so this mostly means a stray
  unsigned native module.
- **Old, un-notarized DMGs** already downloaded by users stay warned; only
  builds made after Steps 3–4 carry the ticket.

## What each credential is

| Env var | Value | What it is |
|---|---|---|
| `APPLE_ID` | your developer Apple ID email | identifies the account |
| `APPLE_APP_SPECIFIC_PASSWORD` | from Step 1 | scoped, revocable password |
| `APPLE_TEAM_ID` | `4QUC4B3L36` | your Developer Program team |
