// Plant fleet for the edge demo: rotating equipment on two production lines.
// Each metric carries its nominal value, noise band, unit and — where a
// standard applies — the alarm limits the detectors use.

export const METRICS = {
  vibration:     { unit: 'mm/s', label: 'Vibration (RMS)' },
  bearingTemp:   { unit: '°C',   label: 'Bearing temp' },
  windingTemp:   { unit: '°C',   label: 'Winding temp' },
  current:       { unit: 'A',    label: 'Motor current' },
  rpm:           { unit: 'rpm',  label: 'Speed' },
  powerFactor:   { unit: '',     label: 'Power factor' },
  flow:          { unit: 'm³/h', label: 'Flow' },
  dischargePressure: { unit: 'bar', label: 'Discharge pressure' },
  suctionPressure:   { unit: 'bar', label: 'Suction pressure' },
  shaftOrbit:    { unit: 'µm',   label: 'Shaft orbit (pk-pk)' },
  misalignment:  { unit: 'mm',   label: 'Offset misalignment' },
  torque:        { unit: 'kNm',  label: 'Torque' },
  surgeMargin:   { unit: '%',    label: 'Surge margin' },
  dischargeTemp: { unit: '°C',   label: 'Discharge temp' },
  oilTemp:       { unit: '°C',   label: 'Oil temp' },
  particleCount: { unit: 'ppm',  label: 'Oil particles' },
};

// nominal: [mean, noise σ]
export const ASSET_TYPES = {
  motor: {
    label: 'Induction motor',
    nominal: { vibration: [1.8, 0.15], bearingTemp: [58, 0.8], windingTemp: [82, 1.0], current: [118, 2.0], rpm: [1485, 3], powerFactor: [0.87, 0.005] },
  },
  centrifugal_pump: {
    label: 'Centrifugal pump',
    nominal: { vibration: [2.2, 0.18], bearingTemp: [55, 0.7], flow: [240, 3.0], dischargePressure: [6.2, 0.06], suctionPressure: [1.4, 0.03], rpm: [2950, 4] },
  },
  shaft: {
    label: 'Drive shaft line',
    nominal: { vibration: [1.6, 0.14], shaftOrbit: [38, 1.5], misalignment: [0.05, 0.005], torque: [4.1, 0.05], bearingTemp: [52, 0.6], rpm: [1480, 3] },
  },
  centrifugal_compressor: {
    label: 'Centrifugal compressor',
    nominal: { vibration: [2.0, 0.16], surgeMargin: [18, 0.4], dischargeTemp: [128, 0.9], dischargePressure: [9.8, 0.07], bearingTemp: [64, 0.7], rpm: [11200, 15] },
  },
  gearbox: {
    label: 'Gearbox',
    nominal: { vibration: [2.4, 0.2], oilTemp: [61, 0.7], particleCount: [14, 0.8], torque: [6.3, 0.07], bearingTemp: [60, 0.7] },
  },
};

export const FLEET = [
  { id: 'MTR-101', name: 'Conveyor drive motor',   type: 'motor',                  line: 'Line A', criticality: 'high' },
  { id: 'MTR-102', name: 'Mixer motor',            type: 'motor',                  line: 'Line B', criticality: 'medium' },
  { id: 'PMP-201', name: 'Cooling water pump',     type: 'centrifugal_pump',       line: 'Utilities', criticality: 'high' },
  { id: 'PMP-202', name: 'Process feed pump',      type: 'centrifugal_pump',       line: 'Line A', criticality: 'high' },
  { id: 'SHF-301', name: 'Main drive shaft',       type: 'shaft',                  line: 'Line A', criticality: 'high' },
  { id: 'SHF-302', name: 'Extruder shaft',         type: 'shaft',                  line: 'Line B', criticality: 'medium' },
  { id: 'CMP-401', name: 'Instrument air compressor', type: 'centrifugal_compressor', line: 'Utilities', criticality: 'critical' },
  { id: 'GBX-601', name: 'Conveyor gearbox',       type: 'gearbox',                line: 'Line A', criticality: 'medium' },
];

// Fault signatures the simulator can inject. `effects` are per-tick drifts
// (fraction of nominal, or absolute when `abs` is set) applied while the fault
// is active; `mode` is the ground-truth failure mode used by evals.
export const FAULTS = {
  bearing_wear:     { label: 'Bearing wear',        appliesTo: ['motor', 'centrifugal_pump', 'shaft', 'gearbox', 'centrifugal_compressor'], effects: { vibration: 0.035, bearingTemp: 0.006 } },
  winding_overheat: { label: 'Winding overheating', appliesTo: ['motor'], effects: { windingTemp: 0.012, current: 0.006, powerFactor: -0.003 } },
  cavitation:       { label: 'Cavitation',          appliesTo: ['centrifugal_pump'], effects: { suctionPressure: -0.03, flow: -0.012, vibration: 0.03 }, jitter: { dischargePressure: 4 } },
  misalignment:     { label: 'Shaft misalignment',  appliesTo: ['shaft', 'motor', 'centrifugal_pump'], effects: { misalignment: 0.08, shaftOrbit: 0.025, vibration: 0.028 } },
  imbalance:        { label: 'Rotor imbalance',     appliesTo: ['motor', 'centrifugal_pump', 'shaft', 'centrifugal_compressor'], effects: { vibration: 0.06 } },
  surge:            { label: 'Compressor surge',    appliesTo: ['centrifugal_compressor'], effects: { surgeMargin: -0.06, dischargeTemp: 0.004, vibration: 0.025 } },
  lubrication:      { label: 'Lubrication breakdown', appliesTo: ['gearbox'], effects: { oilTemp: 0.01, particleCount: 0.05, vibration: 0.02 } },
};

export const assetType = id => FLEET.find(a => a.id === id)?.type;
