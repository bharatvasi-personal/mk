# End-to-end smoke test

Drives the real API over HTTP the way the POS does — sign in, open the drawer, take an
order, cut a KOT, settle with split cash + UPI, then check that stock actually moved, the
invoice number is gapless, a helper cannot see cost prices, and a forged payment webhook
is rejected.

78 assertions.

**It writes real data.** It settles bills, depletes stock, and creates vendors, employees
and menu items — none of which can be rolled back. Run it against a **disposable
database**, not against the shop's. It refuses to target anything but a local API unless
`MK_E2E_ALLOW_REMOTE=yes` is set, precisely so that "run it before every deploy" cannot
quietly mean "run it against production".

For a pre-deploy gate, run it in CI against the ephemeral Postgres service (as
`.github/workflows/ci.yml` does), not against the live system.

```bash
# with the stack up and the API on :4000
node tests/smoke.mjs
```

It is safe to run repeatedly against a development database: every order uses a fresh
`clientRef`, device and card identifiers are randomised, and the menu artefacts it creates
are deactivated at the end so they do not appear on the public site.
