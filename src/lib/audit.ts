import "server-only";
import { getDb, now } from "./db";

export const STATUSES = ["draft", "pending_review", "approved", "rejected", "changes_requested", "archived"] as const;
export type ApprovalStatus = (typeof STATUSES)[number];

/**
 * Prototype identity: a single reviewer name from env. Production replaces this with
 * authenticated users + roles (see docs/SECURITY.md) — every call site already passes through here.
 */
export function currentActor(): string {
  return process.env.DEMO_REVIEWER_NAME || "Demo Reviewer";
}

export function audit(action: string, entityType: string, entityId: number | null, detail = "") {
  getDb()
    .prepare("INSERT INTO audit_log (actor, action, entity_type, entity_id, detail, created_at) VALUES (?,?,?,?,?,?)")
    .run(currentActor(), action, entityType, entityId, detail, now());
}

export function recordApproval(entityType: string, entityId: number, decision: string, comment: string) {
  getDb()
    .prepare("INSERT INTO approvals (entity_type, entity_id, decision, reviewer, comment, created_at) VALUES (?,?,?,?,?,?)")
    .run(entityType, entityId, decision, currentActor(), comment, now());
  audit(`approval.${decision}`, entityType, entityId, comment);
}

export function approvalHistory(entityType: string, entityId: number) {
  return getDb()
    .prepare("SELECT decision, reviewer, comment, created_at FROM approvals WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC")
    .all(entityType, entityId) as { decision: string; reviewer: string; comment: string; created_at: string }[];
}
