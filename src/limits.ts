// The points of the control panel's PLC: I1 to I8, Q1 to Q4 and so on. These
// numbers must match plc_core::fbd::Limits::default().
export const LIMITS = {
  inputs: 8,
  outputs: 4,
  markers: 27,
  analogInputs: 2,
  analogFlags: 16,
} as const;
