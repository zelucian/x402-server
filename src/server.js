// x402-protected Express API server.
//
// Built on the @x402 v2 SDK (resource-server + scheme registration pattern):
//   - paymentMiddleware / x402ResourceServer : @x402/express (see its README "Quick Start")
//   - HTTPFacilitatorClient                  : @x402/core/server
//   - ExactEvmScheme                         : @x402/evm/exact/server
//
// The server holds NO private key. Payment verification and settlement are
// delegated to a remote facilitator (FACILITATOR_URL); this process only
// issues 402 challenges and serves the paid resource after the middleware
// verifies a payment through that facilitator.

import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

// ---------------------------------------------------------------------------
// Configuration (all overridable via environment variables — see .env.example)
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT || 4021);
const PUBLIC_BASE_URL = (
  process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`
).replace(/\/+$/, "");
const PAYTO_ADDRESS =
  process.env.PAYTO_ADDRESS || "0xD5954e77A5ED7a092350b6A8e2E197586A56BeA7";
const NETWORK = process.env.NETWORK || "eip155:8453"; // Base mainnet
const PRICE = process.env.PRICE || "$0.01";
// NOTE: the x402.org public facilitator only supports testnets (its
// /supported lists eip155:84532, not eip155:8453), and @x402/core refuses to
// build a challenge for a network the facilitator does not support. PayAI's
// public facilitator lists { x402Version: 2, scheme: "exact",
// network: "eip155:8453" } and needs no API key, so it is the default here.
const FACILITATOR_URL =
  process.env.FACILITATOR_URL || "https://facilitator.payai.network";

// USDC on Base mainnet — also the @x402/evm default asset for eip155:8453.
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
// $0.01 in USDC atomic units (6 decimals). Kept in sync with PRICE above;
// used for the discovery documents (the middleware computes its own from PRICE).
const PRICE_ATOMIC = "10000";
const MAX_TIMEOUT_SECONDS = 300;

const DESCRIPTION =
  "Paid greeting + rotating crypto fact. One x402 'exact' payment of $0.01 USDC on Base per call.";

// ---------------------------------------------------------------------------
// CORS — must run before the payment middleware so that 402 responses also
// carry the headers, and browser callers can read the payment headers.
// ---------------------------------------------------------------------------
const EXPOSED_HEADERS = ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE"];
const ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "PAYMENT-SIGNATURE",
  "X-PAYMENT",
  "PAYMENT-REQUIRED",
];

function cors(req, res, next) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", EXPOSED_HEADERS.join(", "));
  res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS.join(", "));
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
}

// ---------------------------------------------------------------------------
// x402 resource server + payment middleware
// ---------------------------------------------------------------------------
const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient).register(
  NETWORK,
  new ExactEvmScheme(),
);

const routes = {
  "GET /": {
    accepts: {
      scheme: "exact",
      price: PRICE,
      network: NETWORK,
      payTo: PAYTO_ADDRESS,
      maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    },
    description: DESCRIPTION,
    mimeType: "application/json",
  },
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.use(cors);
app.use(paymentMiddleware(routes, resourceServer));

// The single payment requirement for this API, shared by the discovery docs.
const ACCEPTS = [
  {
    scheme: "exact",
    network: NETWORK,
    amount: PRICE_ATOMIC,
    asset: USDC_BASE,
    payTo: PAYTO_ADDRESS,
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
  },
];

// Paid resource: GET / (only reached after the middleware verifies payment).
const FACTS = [
  "Bitcoin's smallest unit is the satoshi: 1 BTC = 100,000,000 satoshis.",
  "USDC on Base settles in about two seconds per block.",
  "The x402 protocol revives the HTTP 402 'Payment Required' status code, reserved since the 1990s.",
  "Ethereum's first block was mined on 30 July 2015.",
  "Base is an Ethereum L2 built on the OP Stack.",
];

app.get("/", (req, res) => {
  // Deterministic rotation: one fact per minute, same for every caller.
  const fact = FACTS[Math.floor(Date.now() / 60000) % FACTS.length];
  res.json({
    message: "Hello from an x402-protected API — your payment worked.",
    timestamp: new Date().toISOString(),
    fact,
    paidWith: { scheme: "exact", network: NETWORK, asset: USDC_BASE, price: PRICE },
  });
});

// Discovery: OpenAPI 3 document. Every paid operation carries an
// "x-payment-info" block listing x402 and declares a 402 response.
app.get("/openapi.json", (req, res) => {
  res.json({
    openapi: "3.0.3",
    info: {
      title: "x402 Greeting & Crypto Fact API",
      version: "1.0.0",
      description: DESCRIPTION,
    },
    servers: [{ url: PUBLIC_BASE_URL }],
    paths: {
      "/": {
        get: {
          operationId: "getGreeting",
          summary: "Get a greeting and a rotating crypto fact",
          description: DESCRIPTION,
          "x-payment-info": {
            protocols: ["x402"],
            x402Version: 2,
            scheme: "exact",
            network: NETWORK,
            asset: USDC_BASE,
            price: PRICE,
            amount: PRICE_ATOMIC,
            payTo: PAYTO_ADDRESS,
            maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
            paymentRequestHeader: "PAYMENT-SIGNATURE",
            paymentRequiredHeader: "PAYMENT-REQUIRED",
            paymentResponseHeader: "PAYMENT-RESPONSE",
          },
          responses: {
            "200": {
              description: "Paid response: greeting, timestamp and crypto fact.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      message: { type: "string" },
                      timestamp: { type: "string", format: "date-time" },
                      fact: { type: "string" },
                    },
                  },
                },
              },
            },
            "402": {
              description:
                "Payment Required. The PAYMENT-REQUIRED response header carries the base64-encoded x402 payment challenge; pay and retry with a PAYMENT-SIGNATURE header.",
            },
          },
        },
      },
    },
  });
});

// Discovery: version 1 x402 well-known document listing the paid resources.
app.get("/.well-known/x402", (req, res) => {
  res.json({
    version: 1,
    resources: [
      {
        resource: `${PUBLIC_BASE_URL}/`,
        type: "http",
        method: "GET",
        x402Version: 2,
        accepts: ACCEPTS,
        description: DESCRIPTION,
        mimeType: "application/json",
      },
    ],
  });
});

app.listen(PORT, () => {
  console.log(`x402-server listening on http://localhost:${PORT}`);
  console.log(`  public base URL : ${PUBLIC_BASE_URL}`);
  console.log(`  protected route : GET /  (${PRICE} USDC on ${NETWORK}, exact)`);
  console.log(`  payTo           : ${PAYTO_ADDRESS}`);
  console.log(`  facilitator     : ${FACILITATOR_URL}`);
});
