import { digestJson } from "./canonicalize.js";
import { ENGINE_VERSION, TEXT_CANONICALIZATION } from "./receipt.js";
import { receiptStatusHash } from "./status.js";
import type { ProofReceipt } from "./types.js";

export const C2PA_INTEROP_TARGET = {
  specName: "C2PA Technical Specification",
  specVersion: "2.4",
  versionDate: "April 2026",
  url: "https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html",
  note:
    "Selected official C2PA Technical Specification 2.4 because its version history lists 2.4 - April 2026 as the current target for this interop projection.",
} as const;

export interface C2paInteropSidecarOptions {
  receiptReference: string;
  assetFormat?: string;
  claimGeneratorName?: string;
  claimGeneratorVersion?: string;
}

export interface C2paInteropSidecar {
  version: "groundlock-c2pa-interop/v1";
  interopOnly: true;
  warning: string;
  c2paTarget: typeof C2PA_INTEROP_TARGET;
  groundlock: {
    exactContentHash: string;
    hashCanonicalization: typeof TEXT_CANONICALIZATION;
    receiptHash: string;
    signerDomain: string;
    signerKeyId: string;
    contentClass: string;
    receiptReference: string;
  };
  c2paManifestProjection: {
    instanceID: string;
    claim_generator: string;
    claim_generator_info: {
      name: string;
      version: string;
    };
    "dc:format": string;
    alg: "sha256";
    created_assertions: Array<{
      url: string;
      alg: "sha256";
      hash: string;
    }>;
  };
  assertionStore: {
    "com.groundlock.receipt.v1": GroundLockC2paAssertion;
  };
}

export interface GroundLockC2paAssertion {
  label: "com.groundlock.receipt.v1";
  data: {
    exactContentHash: string;
    hashCanonicalization: typeof TEXT_CANONICALIZATION;
    groundlockReceiptHash: string;
    signer: { domain: string; keyId: string };
    contentClass: string;
    receipt: {
      reference: string;
      hash: string;
      mediaType: "application/vnd.groundlock.receipt+json";
    };
  };
}

export function createC2paInteropSidecar(
  receipt: ProofReceipt,
  opts: C2paInteropSidecarOptions,
): C2paInteropSidecar {
  const receiptHash = receiptStatusHash(receipt);
  const claimGeneratorName = opts.claimGeneratorName ?? "GroundLock Receipts";
  const claimGeneratorVersion = opts.claimGeneratorVersion ?? ENGINE_VERSION;
  const assertion: GroundLockC2paAssertion = {
    label: "com.groundlock.receipt.v1",
    data: {
      exactContentHash: receipt.candidateHash,
      hashCanonicalization: TEXT_CANONICALIZATION,
      groundlockReceiptHash: receiptHash,
      signer: { domain: receipt.signerDomain, keyId: receipt.signerKeyId },
      contentClass: receipt.contentClass,
      receipt: {
        reference: opts.receiptReference,
        hash: receiptHash,
        mediaType: "application/vnd.groundlock.receipt+json",
      },
    },
  };

  return {
    version: "groundlock-c2pa-interop/v1",
    interopOnly: true,
    warning:
      "This is GroundLock interop metadata only; it is not an official C2PA manifest store, embed workflow, or C2PA claim signature.",
    c2paTarget: C2PA_INTEROP_TARGET,
    groundlock: {
      exactContentHash: receipt.candidateHash,
      hashCanonicalization: TEXT_CANONICALIZATION,
      receiptHash,
      signerDomain: receipt.signerDomain,
      signerKeyId: receipt.signerKeyId,
      contentClass: receipt.contentClass,
      receiptReference: opts.receiptReference,
    },
    c2paManifestProjection: {
      instanceID: `xmp:iid:groundlock:${receiptHash.slice("sha256:".length)}`,
      claim_generator: claimGeneratorName,
      claim_generator_info: {
        name: claimGeneratorName,
        version: claimGeneratorVersion,
      },
      "dc:format": opts.assetFormat ?? "application/octet-stream",
      alg: "sha256",
      created_assertions: [
        {
          url: "self#jumbf=/c2pa/assertions/com.groundlock.receipt.v1",
          alg: "sha256",
          hash: digestJson(assertion),
        },
      ],
    },
    assertionStore: {
      "com.groundlock.receipt.v1": assertion,
    },
  };
}
