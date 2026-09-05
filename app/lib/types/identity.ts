// §9.1 Identity & tenancy contracts.
//
// The ONE identity contract that every governed-action-creating route converges
// on. `AgentIdentity` mirrors the return of app/lib/identity-resolution.js
// (resolveAgentIdentity): a verified JWT `sub` overrides the self-asserted body
// agent_id; an untrusted token never applies its claims and is marked NOT
// verified, so a reader can always distinguish verified from self-asserted.

import type { Brand, Nullable } from './brand';

export type OrganizationId = Brand<string, 'OrganizationId'>;
export type AgentId = Brand<string, 'AgentId'>;

export type OrganizationRole = 'owner' | 'admin' | 'member' | 'viewer';

/** JWKS verification outcome — mirrors guard_decisions.verification_status. */
export type VerificationStatus =
  | 'verified'
  | 'unverified'
  | 'expired'
  | 'failed'
  | 'unknown_issuer'
  | 'exp_too_far';

/**
 * Result of resolveAgentIdentity(). `verified` distinguishes a cryptographically
 * proven identity from a self-asserted one. `agent_id`/`agent_name` stay plain
 * nullable strings to match the resolver's runtime contract exactly.
 */
export interface AgentIdentity {
  agent_id: Nullable<string>;
  agent_name: Nullable<string>;
  verification_status: VerificationStatus;
  verified: boolean;
  jti: Nullable<string>;
  /** Full verifier result (jwks-verifier.js); narrow before use. */
  verification: unknown;
}
