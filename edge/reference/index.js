// Reference implementations of the six edge features. The ADLC agents build
// their own versions under edge/features/<Fxx>/ against the same contracts;
// the acceptance tests in specs/features/ run against both.
export * from './fleet.js';
export { createSimulator, mulberry32 } from './simulator.js';
export { createDetector, vibrationZone, classify, SEVERITIES, LIMITS, SIGNATURES } from './anomaly.js';
export { createWorkOrderService, PLAYBOOKS } from './workorders.js';
export { createCarService, ROOT_CAUSES } from './car.js';
export { createInventory, PARTS } from './inventory.js';
export { parseQuery, healthScore, answerFromSnapshot } from './nlq.js';
