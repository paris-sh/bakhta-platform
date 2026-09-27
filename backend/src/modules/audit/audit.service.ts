import type { Database } from "../../db/client.js";

// Minimal, write-only audit capability: every other module calls recordAdminAction()
// inside its own mutation (ideally the same transaction, once repository functions accept
// an externally-supplied transaction handle) so audit and business state stay consistent.
// This is deliberately NOT the full Audit module from the architecture proposal (no view/
// export endpoints, no read side) — those stay deferred; this is only the cross-cutting
// write capability other modules need right now.
//
// audit_logs is append-only (0031: UPDATE/DELETE revoked + trigger-enforced) but INSERT
// remains granted to the application role, so this is a normal write from here.

export interface RecordAdminActionInput {
  adminId: string;
  action: string;
  entityType: string;
  entityId: string;
  changedFields?: string[];
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  reason?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Defaults to the column default (INFO). */
  severity?: "INFO" | "WARNING" | "CRITICAL";
}

export function createAuditService(db: Database) {
  return {
    async recordAdminAction(input: RecordAdminActionInput): Promise<void> {
      await db
        .insertInto("audit_logs")
        .values({
          actor_type: "ADMIN",
          actor_admin_id: input.adminId,
          action: input.action,
          entity_type: input.entityType,
          entity_id: input.entityId,
          changed_fields: input.changedFields ?? null,
          old_values: input.oldValues ? JSON.stringify(input.oldValues) : null,
          new_values: input.newValues ? JSON.stringify(input.newValues) : null,
          reason: input.reason ?? null,
          request_id: input.requestId ?? null,
          ip_address: input.ipAddress ?? null,
          user_agent: input.userAgent ?? null,
          ...(input.severity ? { severity: input.severity } : {}),
        })
        .execute();
    },
  };
}

export type AuditService = ReturnType<typeof createAuditService>;
