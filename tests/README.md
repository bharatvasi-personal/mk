# End-to-end smoke test

Drives the real API over HTTP the way the POS does — sign in, open the drawer, take an
order, cut a KOT, settle with split cash + UPI, then check that stock actually moved, the
invoice number is gapless, a helper cannot see cost prices, and a forged payment webhook
is rejected.

53 assertions. Run it before every deploy, and on the morning of 15 Oct.

```bash
# with the stack up and the API on :4000
node tests/smoke.mjs
```

It is safe to run repeatedly against a development database: every order uses a fresh
`clientRef`, and the device and card identifiers it registers are randomised.
