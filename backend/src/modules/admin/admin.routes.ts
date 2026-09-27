import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { createAuthenticateHook } from "../../plugins/authenticate.js";
import { requirePermission } from "../../plugins/authorize.js";
import type { AuthService } from "../auth/auth.service.js";
import { ADMIN_PERMISSIONS } from "../auth/permissions.js";
import {
  auditListQuerySchema,
  auditListResponseSchema,
  dashboardResponseSchema,
  drawListQuerySchema,
  drawListResponseSchema,
  orderDetailResponseSchema,
  orderIdParamsSchema,
  orderListQuerySchema,
  orderListResponseSchema,
  tehranDayEndExclusive,
  tehranDayStart,
} from "./admin.schemas.js";
import type { AdminService } from "./admin.service.js";

// Read-only admin panel endpoints. Every route requires an ADMIN session AND a specific
// permission; nothing here mutates data (mutations stay on the existing games/draws routes).

const range = (from?: string, to?: string) => ({
  from: from ? tehranDayStart(from) : undefined,
  to: to ? tehranDayEndExclusive(to) : undefined,
});

export function registerAdminRoutes(app: FastifyInstance, adminService: AdminService, authService: AuthService): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const authenticate = createAuthenticateHook(authService);

  typed.get(
    "/v1/admin/dashboard",
    {
      preHandler: [authenticate, requirePermission(ADMIN_PERMISSIONS.DASHBOARD_VIEW)],
      schema: { response: { 200: dashboardResponseSchema } },
    },
    async (request) => {
      // requirePermission guarantees an ADMIN principal; sections the admin may not see
      // (orders, audit) are omitted server-side, not merely hidden by the UI.
      const principal = request.principal as { type: "ADMIN"; permissions: string[] };
      return adminService.getDashboard(principal.permissions);
    },
  );

  typed.get(
    "/v1/admin/draws",
    {
      preHandler: [authenticate, requirePermission(ADMIN_PERMISSIONS.DRAWS_VIEW)],
      schema: { querystring: drawListQuerySchema, response: { 200: drawListResponseSchema } },
    },
    async (request) => {
      const q = request.query;
      return adminService.listDraws({ ...q, ...range(q.from, q.to) });
    },
  );

  typed.get(
    "/v1/admin/orders",
    {
      preHandler: [authenticate, requirePermission(ADMIN_PERMISSIONS.ORDERS_VIEW)],
      schema: { querystring: orderListQuerySchema, response: { 200: orderListResponseSchema } },
    },
    async (request) => {
      const q = request.query;
      return adminService.listOrders({ ...q, ...range(q.from, q.to) });
    },
  );

  typed.get(
    "/v1/admin/orders/:id",
    {
      preHandler: [authenticate, requirePermission(ADMIN_PERMISSIONS.ORDERS_VIEW)],
      schema: { params: orderIdParamsSchema, response: { 200: orderDetailResponseSchema } },
    },
    async (request) => adminService.getOrder(request.params.id),
  );

  typed.get(
    "/v1/admin/audit-logs",
    {
      preHandler: [authenticate, requirePermission(ADMIN_PERMISSIONS.AUDIT_VIEW)],
      schema: { querystring: auditListQuerySchema, response: { 200: auditListResponseSchema } },
    },
    async (request) => {
      const q = request.query;
      return adminService.listAudit({ ...q, ...range(q.from, q.to) });
    },
  );
}
