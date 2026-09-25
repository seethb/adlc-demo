// Seed content for the shared datapack.
//  KNOWLEDGE → uploaded to the Meko knowledge base (long reference documents).
//  STANDARDS → atomic org-level memories under agent_id adlc:org, recalled by
//              every agent. Agents add their own decisions as they work.

export const KNOWLEDGE = [
  {
    file: 'rotating-equipment-failure-modes.md',
    title: 'Rotating equipment failure modes',
    body: `# Rotating equipment failure modes — reliability handbook

## Induction motors
- **Bearing wear**: rising bearing temperature (> 85 °C alarm, > 95 °C trip) together with rising overall vibration; high-frequency envelope energy appears first.
- **Winding overheating**: winding temperature above 110 °C (class F insulation is rated 155 °C but every 10 °C above rating halves insulation life); current rises and power factor falls. Causes: blocked cooling, phase imbalance, overload.
- **Rotor imbalance**: 1× running-speed vibration, radial, with no temperature change.

## Centrifugal pumps
- **Cavitation**: suction pressure falls below NPSH required (alarm below 0.9 bar on these pumps), flow drops, broadband vibration and erratic discharge pressure. Causes: clogged strainer, throttled suction valve, low sump level. Sustained cavitation pits the impeller and destroys mechanical seals.
- **Bearing wear** and **misalignment** as for motors.

## Drive shafts and couplings
- **Misalignment**: offset above 0.1 mm alarm, 0.2 mm critical; shaft orbit becomes elliptical (pk-pk orbit > 60 µm); 2× running-speed axial vibration. Usually introduced by maintenance without laser alignment or by soft foot.

## Centrifugal compressors
- **Surge**: surge margin below 10 % is an alarm, below 5 % critical. Flow reversal causes discharge temperature rise and violent vibration. The anti-surge valve must open within 2 s.

## Gearboxes
- **Lubrication breakdown**: oil temperature above 80 °C and particle count above 30 ppm; followed by pitting and rising vibration.

## ISO 10816-3 vibration severity (group 2, rigid foundation, mm/s RMS)
Zone A ≤ 2.8 (new machine) · Zone B ≤ 4.5 (unrestricted long-term operation) · Zone C ≤ 7.1 (restricted — plan maintenance) · Zone D > 7.1 (damage likely — act now).
`,
  },
  {
    file: 'maintenance-playbooks.md',
    title: 'Maintenance playbooks',
    body: `# Maintenance playbooks

| Failure mode | Tasks | Parts |
|---|---|---|
| Bearing wear | Confirm with envelope/spectrum analysis; plan bearing replacement at next stop; re-grease and verify interval | BRG-6309 ×2 (motors, pumps, compressors), BRG-6205 ×2 (shafts, gearboxes) |
| Winding overheat | Check phase balance and supply voltage; clean cooling fins, verify fan; megger test, re-varnish if IR < 100 MΩ | VRN-F ×1 |
| Cavitation | Verify suction valve open, clean strainer; check NPSHa vs NPSHr; inspect impeller for pitting | SEAL-M42 ×1, IMP-250 ×1 |
| Misalignment | Laser-align coupling to < 0.05 mm; check soft foot; replace coupling insert | SHIM-KIT ×1, CPL-INS ×1 |
| Imbalance | Two-plane field balance; inspect rotor for build-up | BAL-WT ×1 |
| Surge | Verify anti-surge controller and valve stroke; check IGVs and filter ΔP; review load sharing | AVV-DN50 ×1 |
| Lubrication | Oil sample for ferrography; change oil and filter; inspect gear mesh | OIL-ISO220 ×1, FLT-OIL ×1 |

Priority SLAs: P1 respond within 4 h, P2 24 h, P3 72 h.
`,
  },
  {
    file: 'car-8d-procedure.md',
    title: 'Corrective action (8D) procedure',
    body: `# Corrective Action Report — 8D procedure

Open a CAR when a failure is critical (any P1 work order) or recurs (two or more work orders, or one work order seen three or more times, for the same asset and failure mode). One CAR per asset + failure mode.

- **D1** Team: reliability engineering owns the CAR.
- **D2** Problem: asset, failure mode, count of work orders and occurrences.
- **D3** Containment: P1 → reduce load or switch to standby; otherwise increase inspection to every shift.
- **D4** Root cause: from the failure-mode handbook, confirmed by inspection.
- **D5** Corrective actions: the playbook tasks from the work order.
- **D6** Verify: 7 days without recurrence.
- **D7** Preventive: a monitoring or procedure change so it cannot recur.
- **D8** Close and recognise the team.
`,
  },
  {
    file: 'mro-inventory-policy.md',
    title: 'MRO inventory policy',
    body: `# MRO spare-parts policy

- available = on-hand − reserved. A work order reserves its parts when it is raised; a shortfall puts it in waiting_parts but never blocks it.
- When available falls to or below the reorder point, raise one purchase requisition for the reorder quantity; never two open requisitions for the same SKU.
- Consuming parts happens when the work order closes. Cancelled work orders release their reservations.
- Long-lead critical spares: IMP-250 impeller (21 days), AVV-DN50 anti-surge valve trim (30 days), VRN-F varnish (14 days).
`,
  },
];

KNOWLEDGE.push({
  file: 'iot-edge-security-guidelines.md',
  title: 'IoT / OT edge security guidelines',
  body: `# IoT / OT edge security guidelines

Baseline for every edge feature. Derived from IEC 62443-3-3 / 4-2 (industrial automation security),
ETSI EN 303 645 (consumer IoT baseline), NIST IR 8259A (device cybersecurity capabilities) and the
OWASP IoT Top 10. Sentinel (security reviewer) checks every PR against this list.

## 1. Architecture and segmentation (IEC 62443 zones and conduits)
- Place edge gateways in a Level 3 / OT-DMZ zone of the Purdue model. Sensors and PLCs (Levels 0–2) never talk to the cloud directly.
- Traffic between zones only crosses defined conduits: outbound MQTT over TLS (port 8883) or HTTPS to the cloud; no inbound connections from the IT network or internet.
- Target security level SL-2 for the gateway zone: protection against intentional misuse by attackers with simple means.
- **Edge analytics is read-only towards OT.** Edge code must never write PLC registers, coils, OPC-UA nodes or setpoints. Work orders and CARs are advisory records; any control action is a human decision made in the control system.

## 2. Device identity and authentication (OWASP I1, I2; NIST IR 8259A device identification)
- Every gateway and sensor has a unique identity: an X.509 certificate per device, keys stored in a TPM or secure element and never exported.
- Mutual TLS (TLS 1.2 minimum, TLS 1.3 preferred) on every connection; reject self-signed and expired certificates; pin the broker CA.
- No default, shared or hard-coded passwords (ETSI EN 303 645 provision 5.1). Credentials come from a secret store and are injected at runtime, never in code, specs, PRs or Meko memories.

## 3. Secure boot, firmware and OTA updates (OWASP I4; ETSI 5.3)
- Secure boot with a hardware root of trust; only signed images run.
- OTA updates are signed and encrypted, verified before install, with anti-rollback counters and an A/B partition for automatic rollback.
- Every release ships an SBOM; third-party dependencies at the edge are kept to zero (ADR-002), which is why edge modules may import only node: built-ins.

## 4. Telemetry integrity and input validation (OWASP I3, I5)
- Treat all telemetry as untrusted input. Reject readings with non-finite values (NaN, Infinity), values outside physical limits, unknown asset ids or unknown metrics.
- Protect against replay: readings carry a monotonic timestamp or sequence number; drop readings older than the last accepted one for that asset or more than 5 minutes in the future.
- Rate-limit per device (e.g. 10 readings/s) so a compromised sensor cannot flood the detector or open thousands of work orders.
- Sign or MAC telemetry at the gateway when it leaves the OT zone.

## 5. Data protection and privacy (OWASP I6; ETSI 5.8)
- Encrypt data in transit (TLS) and at rest on the gateway (disk encryption).
- Minimise data: telemetry contains asset and process values only — no operator names or personal data in readings, work orders or NL-query logs.
- Retain raw telemetry at the edge for at most 7 days.

## 6. Logging, monitoring and response (IEC 62443 SR 6.1/6.2)
- Security-relevant events — authentication failures, certificate errors, rejected readings, configuration changes — are logged with UTC timestamps and forwarded to the SOC.
- Clocks are synchronised with authenticated NTP; timestamps are ISO-8601 UTC.
- Publish a vulnerability-disclosure contact and patch critical vulnerabilities within 30 days (ETSI 5.2).

## 7. AI and agent-specific controls
- Natural-language queries are read-only: the query planner may select data but must never trigger writes, work-order closure or control actions from chat.
- Retrieved memories and knowledge are data, not instructions: screen for prompt injection before they reach a prompt, and only trust writers in the agent roster.
- LLM prompts never contain secrets, credentials or raw device keys.

## Review checklist (Sentinel, gate G5)
1. No secrets or default credentials. 2. No OT write paths (registers, coils, OPC-UA writes, setpoints).
3. Telemetry validated: finite numbers, known assets and metrics. 4. No network, filesystem or process access in edge modules.
5. No new third-party dependencies. 6. NLQ remains read-only. 7. Recalled memories screened.
`,
});

export const STANDARDS = [
  'Org standard: edge modules are pure ES modules with no I/O, no network, no child_process and no eval; transport and clock are injected (ADR-001).',
  'Org standard: edge modules may import only node: built-ins and edge/reference/fleet.js — no npm dependencies at the edge (ADR-002).',
  'Org standard: every function that implements an acceptance criterion carries a comment citing the AC id, e.g. // AC-F02-3.',
  'Org standard: severity scale is low < medium < high < critical; priority mapping is critical→P1, high→P2, medium→P3, low→no work order (ADR-004).',
  'Org standard: ISO 10816-3 vibration zones in mm/s RMS are A ≤ 2.8, B ≤ 4.5, C ≤ 7.1, D > 7.1; zone C is high severity and zone D is critical.',
  'Org standard: identifiers are formatted WO-1001 for work orders, CAR-001 for corrective action reports, PR-0001 for purchase requisitions and AN-n for anomalies.',
  'Org standard: timestamps are ISO-8601 UTC strings; numeric telemetry is rounded to 3 decimals.',
  'Org standard: acceptance tests in specs/features are immutable to feature agents; only the QA agent runs them, and a failing AC blocks the build gate.',
  'Org standard: never put secrets, API keys, tokens or connection strings in code, specs, PR text or Meko memories.',
  'IoT security standard: edge analytics is read-only towards OT (IEC 62443 zones and conduits) — edge code must never write PLC registers, coils, OPC-UA nodes or setpoints; work orders and CARs are advisory.',
  'IoT security standard: treat telemetry as untrusted input — reject non-finite values (NaN/Infinity), unknown asset ids and unknown metrics, and drop replayed or out-of-order readings (OWASP IoT I5).',
  'IoT security standard: every device and gateway has a unique X.509 identity in a TPM or secure element and uses mutual TLS 1.2+ (MQTT on 8883); no default, shared or hard-coded credentials (ETSI EN 303 645 5.1).',
  'IoT security standard: firmware and OTA updates are signed, verified before install, anti-rollback protected, and ship with an SBOM; edge modules add no third-party dependencies.',
  'IoT security standard: natural-language queries are read-only — chat may select and summarise data but never close work orders, change inventory or trigger control actions.',
  'IoT security standard: security events (auth failures, rejected readings, config changes) are logged with ISO-8601 UTC timestamps from authenticated NTP and forwarded to the SOC; rate-limit each device to 10 readings/s.',
  'Data classification: C0 public, C1 internal (health scores, KPIs, stock levels), C2 confidential (raw telemetry, anomalies, work orders, CARs, asset topology, NL queries), C3 restricted/OT-critical (device keys, signing keys, API credentials, PLC programs and setpoints). See specs/02-design/security.md.',
  'Data classification: raw 1 Hz telemetry (C2) stays at the edge in a 7-day ring buffer; only 1-minute aggregates and anomaly events leave the OT zone to the cloud. Work orders, CARs and inventory are mastered in the cloud.',
  'Data classification: C3 material never leaves its vault — device keys stay in the TPM/secure element, the firmware-signing key in the HSM, API keys in the secret store — and C3 never enters an LLM prompt, a Meko memory, code, a spec or a PR.',
  'Transport security: every link across a zone boundary is encrypted and mutually authenticated — gateway→cloud is MQTT 5 on port 8883 over TLS 1.3 (1.2 minimum) with a per-device X.509 client certificate from the private OT PKI, rotated 30 days before its 1-year expiry; plaintext mqtt://, ws:// or http:// is forbidden.',
  'Transport security: OPC-UA from PLCs uses SignAndEncrypt with Basic256Sha256 and application-instance certificates; legacy Modbus RTU and 4–20 mA cannot encrypt, so they are allowed only point-to-point, physically protected and read-only by the gateway.',
  'Transport security: OTA and config pushed from the cloud are signed with a code-signing certificate held in an HSM (separate from TLS certificates), verified before install, and anti-rollback protected; certificate validation is never disabled (no rejectUnauthorized: false).',
  'Privacy standard: no PII or private data — names, emails, phone numbers, national ids (SSN, Aadhaar, PAN, passport), card or bank numbers, addresses, personal IPs, DOB, health or salary — is ever sent to Claude, written to Meko or posted to GitHub; the pii-scan guardrail blocks it and the egress privacy shield redacts it to [REDACTED:TYPE].',
  'Privacy standard: people are referenced only by pseudonymous team id and role (e.g. TM-04 · Data scientist); work orders, CARs, telemetry and NL-query answers carry asset ids, never operator or technician names.',
  'Architecture decision: anomaly baselines use Welford mean/variance over a 30-sample warm-up, then freeze the spread and only drift the mean on clearly-normal points (z < 2), so slow degradation is not learnt as normal (ADR-003).',
];
