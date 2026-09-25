# Security design — data classification, Edge/Cloud residency and transport crypto

Applies to every feature. Standards: IEC 62443-3-3 (zones, conduits, SL-2 target),
ETSI EN 303 645, NIST IR 8259A, OWASP IoT Top 10. Sentinel checks each PR against it
(gate G5); the `plaintext-transport`, `secret-scan` and `ot-write-prohibited` guardrails
enforce the mechanical parts.

## 1. Data classification

| Class | Meaning | Examples in this system |
|---|---|---|
| **C0 Public** | Safe to publish | Product documentation, open-source code in this repo |
| **C1 Internal** | Low impact if disclosed | Fleet health scores, aggregated KPIs, part catalogue and stock levels, Meko design decisions |
| **C2 Confidential** | Reveals production capacity, process know-how or plant weaknesses | Raw telemetry, anomalies, work orders, CARs, asset register and topology, NL-query questions and answers, firmware images |
| **C3 Restricted / OT-critical** | Enables an attacker to impersonate devices or change the process | Device private keys, firmware-signing keys, broker and API credentials (Meko, Claude, GitHub), PLC programs and setpoints, OT network diagrams |

## 2. Where each data type may live (Edge vs Cloud)

| Data | Class | Edge gateway | Cloud | Rule |
|---|---|---|---|---|
| Raw telemetry (1 Hz) | C2 | ✅ 7-day ring buffer | ❌ | Stays at the edge. Only 1-minute aggregates and anomalies leave the OT zone. |
| 1-min aggregates | C2 | ✅ | ✅ | Sent over MQTT/mTLS. |
| Anomaly events (F02) | C2 | ✅ source | ✅ | Sent over MQTT/mTLS, QoS 1. |
| Work orders and CARs (F03/F04) | C2 | cache | ✅ system of record | The CMMS in the cloud is authoritative. |
| Inventory (F05) | C1 | read cache | ✅ system of record | |
| NL-query prompts and answers (F06) | C2 | ❌ | ✅ | The prompt carries only the minimal C1/C2 slice selected by `parseQuery`. **Never C3.** |
| Meko memories and knowledge | C1–C2 | ❌ | ✅ | Decisions and standards only. `secret-scan` blocks C3 from ever being written. |
| Device identity keys | C3 | 🔒 TPM / secure element only | ❌ | Never exported, never logged. |
| Firmware-signing key | C3 | ❌ | 🔒 HSM only | Used only by the release pipeline. |
| API keys (Meko, Claude, GitHub) | C3 | ❌ | 🔒 secret store | Injected at runtime. Never in code, specs, PRs or prompts. |

## 3. Does communication need encryption and certificates? — Yes

Every link that crosses a zone boundary is encrypted **and** mutually authenticated. No
plaintext protocol (`mqtt://`, `http://`, `ws://`) is allowed anywhere past the cell zone.

| # | Link | Protocol | Encryption | Certificates / auth |
|---|---|---|---|---|
| L1 | Sensor / PLC → edge gateway (inside the cell zone, Purdue L0–2 → L3) | OPC-UA, or legacy Modbus RTU / 4–20 mA | OPC-UA `SignAndEncrypt`, `Basic256Sha256` or better | OPC-UA **application-instance certificate** on both client and server, trust-list managed. Legacy Modbus / 4–20 mA cannot encrypt, so compensating controls apply: physically protected, point-to-point, and the gateway is the only reader (read-only). |
| L2 | Edge gateway → cloud broker (OT-DMZ → cloud conduit) | MQTT 5 on **8883** | **TLS 1.3** (TLS 1.2 minimum), AEAD ciphers only | **Mutual TLS with a per-device X.509 certificate** (CN = gateway id), issued by a private OT PKI intermediate CA. 1-year validity, auto-rotated 30 days before expiry (EST). Broker CA pinned. Revocation via CRL/OCSP. |
| L3 | Cloud → edge (config and OTA) | HTTPS / MQTT over mTLS | TLS 1.3 | Payloads **signed** with a code-signing certificate held in an HSM, separate from TLS certificates. Verified before install; anti-rollback counters. **No control commands to OT.** |
| L4 | Studio / API → Meko, GitHub, Claude | HTTPS | TLS 1.2+ with a public CA | Bearer tokens from the secret store, least-privilege scopes. Certificate validation always on (`rejectUnauthorized` is never `false`). |
| L5 | User → ADLC Studio | HTTPS | TLS 1.2+ | SSO (OIDC) in production. The local demo binds to localhost only. |

**End-to-end integrity:** anomaly and aggregate payloads may additionally be signed (COSE/JWS)
at the gateway, so integrity survives broker hops.

**At rest:**
- Gateway disk: AES-256 (LUKS), keyed from the TPM.
- Cloud stores: AES-256 with KMS-managed keys.
- C3 material: only in an HSM or secure element.

## 4. Handling rules by class

| | C1 | C2 | C3 |
|---|---|---|---|
| TLS in transit | required | required + mTLS across zones | never transmitted, except provisioning inside an HSM ceremony |
| Encrypted at rest | recommended | required | HSM / secure element |
| May enter an LLM prompt | yes | minimal slice only | **never** |
| May be stored in Meko | yes | decisions and summaries only | **never** |
| Retention | 1 year | edge 7 days · cloud 1 year | lifetime of the key |
| Logs | allowed | ids only, no values in security logs | never logged |

## 5. Guardrails that enforce this
- `plaintext-transport` blocks `mqtt://`, `ws://`, non-localhost `http://`, `rejectUnauthorized: false`, `tls: false` and `insecure: true` in code and designs.
- `secret-scan` blocks C3 material in code, PR text and Meko memories.
- `ot-write-prohibited` blocks Modbus/OPC-UA writes and setpoint changes in edge code (read-only towards OT).
- `prompt-injection` and `memory-provenance` screen recalled memories before they reach an LLM.
