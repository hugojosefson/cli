/** @module Feature detection result contracts. */

/** The repository item described by detection findings. */
export interface DetectionSubject {
  readonly kind: string;
  readonly identifier: string;
}

/** An observation that supports a feature state. */
export interface DetectionEvidence {
  readonly code: string;
  readonly kind: string;
  readonly subject: DetectionSubject;
  readonly observation: string;
  readonly resolution?: string;
}

/** A condition that causes drift or prevents a certain feature classification. */
export interface DetectionIssue {
  readonly code: string;
  readonly kind: string;
  readonly subject: DetectionSubject;
  readonly observation: string;
  readonly resolution: string;
}

/** The observed state of one feature and the facts that support it. */
export type FeatureDetection =
  | {
    readonly state: "disabled";
    readonly evidence: readonly DetectionEvidence[];
  }
  | {
    readonly state: "enabled";
    readonly evidence: readonly DetectionEvidence[];
  }
  | {
    readonly state: "drifted";
    readonly evidence: readonly DetectionEvidence[];
    readonly issues: readonly DetectionIssue[];
  }
  | {
    readonly state: "ambiguous";
    readonly evidence: readonly DetectionEvidence[];
    readonly issues: readonly DetectionIssue[];
  };
