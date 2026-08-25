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

## Step 3 — Enable notarization in the build config (one time)

In `package.json`, under `build.mac`, add:

```json
"notarize": true
```

electron-builder picks up credentials from the environment at build time.

## Step 4 — Build a notarized release

From the project root:

```sh
export APPLE_ID="YOUR_APPLE_ID@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="4QUC4B3L36"
npx electron-builder --mac
```

electron-builder will sign, upload to Apple, wait for the verdict (usually
2–10 minutes; first submission can take longer), and staple the ticket to the
app and DMG automatically. If the build hangs at "notarizing", that is normal —
it is waiting on Apple.

## Step 5 — Verify before shipping

```sh
xcrun stapler validate "release/Entitled-Goose-mac-arm64.dmg"
spctl -a -t open --context context:primary-signature -v "release/Entitled-Goose-mac-arm64.dmg"
```

Expected: `The validate action worked!` and `source=Notarized Developer ID`.
Only upload artifacts to the GitHub release after both checks pass.

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
