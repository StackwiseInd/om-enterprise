import { afterAll, describe, expect, it, vi } from "vitest";

const saved = process.env.DATABASE_URL;
afterAll(() => {
  if (saved === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved;
});

describe("database pool", () => {
  it("survives an idle connection being closed by the server", async () => {
    // Nothing connects until a query runs, so a placeholder address is enough.
    process.env.DATABASE_URL = "postgres://u:p@127.0.0.1:1/none";
    const { getPool } = await import("@/server/db/client");
    const pool = getPool();
    expect(pool.listenerCount("error")).toBeGreaterThan(0);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // What pg-pool emits when the server ends an idle client; unhandled, this would throw.
    expect(() => pool.emit("error", new Error("Connection terminated unexpectedly"))).not.toThrow();
    expect(warn).toHaveBeenCalledWith("[db] idle connection closed:", "Connection terminated unexpectedly");
    warn.mockRestore();
    await pool.end();
  });
});
