import { describe, expect, it } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { requirePermission, requirePrincipalType } from "../../src/plugins/authorize.js";

function fakeRequest(principal?: unknown): FastifyRequest {
  return { principal } as unknown as FastifyRequest;
}
const fakeReply = {} as FastifyReply;

describe("requirePrincipalType", () => {
  it("throws when no principal is set", async () => {
    await expect(requirePrincipalType("USER")(fakeRequest(undefined), fakeReply)).rejects.toThrow();
  });

  it("throws when the principal is the wrong type", async () => {
    await expect(
      requirePrincipalType("ADMIN")(
        fakeRequest({ type: "USER", sessionId: "s", userId: "u" }),
        fakeReply,
      ),
    ).rejects.toThrow();
  });

  it("passes when the principal matches", async () => {
    await expect(
      requirePrincipalType("USER")(
        fakeRequest({ type: "USER", sessionId: "s", userId: "u" }),
        fakeReply,
      ),
    ).resolves.toBeUndefined();
  });
});

describe("requirePermission", () => {
  it("throws for a non-admin principal", async () => {
    await expect(
      requirePermission("results.publish")(
        fakeRequest({ type: "USER", sessionId: "s", userId: "u" }),
        fakeReply,
      ),
    ).rejects.toThrow();
  });

  it("throws when the admin lacks the permission", async () => {
    await expect(
      requirePermission("results.publish")(
        fakeRequest({ type: "ADMIN", sessionId: "s", adminId: "a", permissions: ["other.code"] }),
        fakeReply,
      ),
    ).rejects.toThrow();
  });

  it("passes when the admin holds the permission", async () => {
    await expect(
      requirePermission("results.publish")(
        fakeRequest({
          type: "ADMIN",
          sessionId: "s",
          adminId: "a",
          permissions: ["results.publish"],
        }),
        fakeReply,
      ),
    ).resolves.toBeUndefined();
  });
});
