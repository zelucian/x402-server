# x402-server

A minimal [x402](https://x402.org)-protected API built with Express and the
official `@x402` v2 SDK. It sells one tiny resource — a greeting plus a
rotating crypto fact — for **$0.01 USDC on Base mainnet** per call, using the
x402 `exact` scheme.

It was built to be listed on **vAPI** (api.vapinetwork.ai, "Discover your
API" flow), whose checker requires from the live origin:

1. The protected route answers **HTTP 402** with a valid x402 challenge when
   unpaid (not 200).
2. `/openapi.json` serves an **OpenAPI 3** document (`info.title`,
   `info.version`, `paths`); every paid operation carries an
   **`x-payment-info`** block listing x402 plus a **`402` response**.
3. `/.well-known/x402` serves a **version 1** x402 document listing resources.
4. **CORS** exposes `PAYMENT-REQUIRED`, `PAYMENT-RESPONSE` and the payment
   request headers for browser callers.

All four are implemented here and verified locally (evidence below).

## How it works

- `GET /` is protected by `paymentMiddleware` from `@x402/express`, backed by
  an `x402ResourceServer` with `ExactEvmScheme` (`@x402/evm/exact/server`)
  registered for `eip155:8453`.
- The server **holds no private key**. Verification and settlement are
  delegated to a remote facilitator via `HTTPFacilitatorClient`
  (`@x402/core/server`).
- Facilitator choice: `@x402/core` refuses to build a challenge for a
  network/scheme the facilitator does not support. The x402.org public
  facilitator is **testnet-only** (its `/supported` lists `eip155:84532`, not
  `eip155:8453`), so the default facilitator here is PayAI's keyless public
  facilitator, whose `/supported` includes
  `{ "x402Version": 2, "scheme": "exact", "network": "eip155:8453" }`.
  Override with `FACILITATOR_URL` if you run your own.

## Run it

```bash
pnpm install
pnpm start            # node src/server.js
# optional configuration: cp .env.example .env, edit, then
#   node --env-file=.env src/server.js
```

## Configuration

| Env var           | Default                              | Meaning                                   |
| ----------------- | ------------------------------------ | ----------------------------------------- |
| `PORT`            | `4021`                               | Listen port                               |
| `PUBLIC_BASE_URL` | `http://localhost:<PORT>`            | Public origin used in discovery documents |
| `PAYTO_ADDRESS`   | `0xD5954e77A5ED7a092350b6A8e2E197586A56BeA7` | Wallet receiving payments      |
| `NETWORK`         | `eip155:8453`                        | Base mainnet (CAIP-2)                     |
| `PRICE`           | `$0.01`                              | Price per call of `GET /`                 |
| `FACILITATOR_URL` | `https://facilitator.payai.network`  | Verify/settle facilitator (keyless)       |

Asset: USDC on Base, `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
(the `@x402/evm` default asset for `eip155:8453`); $0.01 = `10000` atomic units.

## Local test evidence (24 Nov 2026, server on http://localhost:4021)

**(a) Unpaid `GET /` → 402 + challenge**

```
HTTP/1.1 402 Payment Required
Access-Control-Expose-Headers: PAYMENT-REQUIRED, PAYMENT-RESPONSE
PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6MiwiZXJyb3IiOiJQYXltZW50IHJlcXVpcmVkIiw...
```

Decoded `PAYMENT-REQUIRED`:

```json
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": { "url": "http://localhost:4021/", "mimeType": "application/json" },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:8453",
      "amount": "10000",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "payTo": "0xD5954e77A5ED7a092350b6A8e2E197586A56BeA7",
      "maxTimeoutSeconds": 300,
      "extra": { "name": "USD Coin", "version": "2" }
    }
  ]
}
```

**(b) `GET /openapi.json` → 200**, parses as OpenAPI `3.0.3`,
`info.title = "x402 Greeting & Crypto Fact API"`, `info.version = "1.0.0"`;
the `GET /` operation carries `x-payment-info` with
`protocols: ["x402"]` (plus scheme/network/asset/price/payTo) and declares a
`402` response.

**(c) `GET /.well-known/x402` → 200**:

```json
{
  "version": 1,
  "resources": [
    {
      "resource": "http://localhost:4021/",
      "type": "http",
      "method": "GET",
      "x402Version": 2,
      "accepts": [ { "scheme": "exact", "network": "eip155:8453", "amount": "10000", "...": "..." } ]
    }
  ]
}
```

**(d) CORS** — `OPTIONS /` preflight → `204` with:

```
Access-Control-Allow-Origin: *
Access-Control-Expose-Headers: PAYMENT-REQUIRED, PAYMENT-RESPONSE
Access-Control-Allow-Headers: Content-Type, Authorization, PAYMENT-SIGNATURE, X-PAYMENT, PAYMENT-REQUIRED
```

The same expose-headers are also present on the 402 response itself.

## Remaining steps for go-live

1. Deploy `src/server.js` behind a **public HTTPS origin** you control
   (the URL must resolve only to public internet addresses; vAPI never
   proxies the call).
2. Set `PUBLIC_BASE_URL` to that origin (and adjust `PORT` etc. as needed),
   restart, and re-run the four curl checks above against the public origin.
3. In vAPI's **Discover your API** flow, enter the origin with method `GET`,
   let it re-check the route against its live x402 challenge, then complete
   the Describe / Payout steps.
