export type RecordingRepair = { buffer:ArrayBuffer; original_seconds:number; adjusted_seconds:number; turns:number };
export function repairRecordingWav(buffer:ArrayBuffer):RecordingRepair;
