export type NativeFile = { digest: string; bytes: number; mode: number };
export type NativeFiles = Record<string, NativeFile>;
export type NativeTool = {
  path: string;
  file: NativeFile;
  version: string;
};
export type NativeBuildInputs = {
  files: NativeFiles;
  inventory: string[];
  tools: Record<string, NativeTool>;
};
export type NativeGraph = { files: string[]; external: string[] };
export type NativeReceipt = {
  schema: 1;
  source: string;
  emitted: string;
  dependencies: string;
  packageFiles: string;
  inventory: string[];
  tools: Record<string, NativeTool>;
  groups: Record<string, NativeGraph>;
  buildMs: number;
  observationMs: number;
};
export type NativeSnapshot = {
  schema: 1;
  inventory: string[];
  groups: Record<string, { key: string; inputs: Record<string, string> }>;
  context: string;
  receipt: string;
  dependencyFiles: number;
  dependencyBytes: number;
  buildMs: number;
  buildObservationMs: number;
};
export type NativeObservation = {
  schema: 1;
  mode: "observation-only";
  cacheEligible: false;
  snapshot: NativeSnapshot;
  observationMs: number;
  limits: string[];
};
