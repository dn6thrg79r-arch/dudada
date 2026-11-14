import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { it, expect } from "vitest";

it("실제 SQL: 아이디 변경은 UUID를 유지하고 타인·이전 아이디·익명 변경을 차단한다", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key, email text unique);
      create function auth.uid() returns uuid language sql as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
      $$;
      grant usage on schema public,auth to anon,authenticated;
      insert into auth.users values
      ('00000000-0000-4000-8000-000000000001','u.'||encode(sha256(convert_to('123','UTF8')),'hex')||'@accounts.dudada.invalid'),
      ('00000000-0000-4000-8000-000000000002','u.'||encode(sha256(convert_to('다른사람','UTF8')),'hex')||'@accounts.dudada.invalid');
    `);
    const migration = readFileSync("supabase/account-settings.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration); // idempotent on an existing installation
    const as = async (owner: number) =>
      db.exec(
        `reset role; set request.jwt.claim.sub='00000000-0000-4000-8000-${String(owner).padStart(12, "0")}'; set role authenticated;`,
      );
    const call = async (sql: string) =>
      (await db.query<{ value: unknown }>(`select ${sql} as value`)).rows[0]
        .value;
    await as(1);
    await expect(call("public.register_study_username('123')")).resolves.toBe(
      "123",
    );
    await expect(
      call("public.rename_study_username('다른사람')"),
    ).rejects.toThrow("username_taken");
    expect(await call("public.current_study_username()")).toBe("123");
    expect(await call("public.rename_study_username('새아이디')")).toBe(
      "새아이디",
    );
    await expect(call("public.register_study_username('123')")).rejects.toThrow(
      "username_changed",
    );
    expect(await call("public.current_study_username()")).toBe("새아이디");
    await expect(
      db.exec(
        "update public.study_usernames set owner_id='00000000-0000-4000-8000-000000000002'",
      ),
    ).rejects.toThrow("permission denied");
    await as(2);
    expect(await call("public.register_study_username('다른사람')")).toBe(
      "다른사람",
    );
    await expect(
      call("public.rename_study_username('새아이디')"),
    ).rejects.toThrow("username_taken");
    await expect(call("public.rename_study_username('123')")).rejects.toThrow(
      "username_taken",
    );
    expect(
      (await db.query("select * from public.study_usernames")).rows,
    ).toHaveLength(1);
    await db.exec("reset role; set request.jwt.claim.sub=''; set role anon;");
    expect(await call("public.resolve_study_username('123')")).toEqual({
      status: "retired",
    });
    expect(await call("public.resolve_study_username('새아이디')")).toEqual({
      status: "active",
      email: "u." + (await hex("123")) + "@accounts.dudada.invalid",
    });
    await expect(
      call("public.rename_study_username('침입자')"),
    ).rejects.toThrow("permission denied");
    await expect(
      db.query("select * from public.study_usernames"),
    ).rejects.toThrow("permission denied");
    await as(1);
    expect(await call("public.rename_study_username('123')")).toBe("123");
    await db.exec("reset role;");
    const users = await db.query("select * from auth.users");
    expect(users.rows).toHaveLength(2);
    expect(users.rows[0]).toMatchObject({
      id: "00000000-0000-4000-8000-000000000001",
      email: "u." + (await hex("123")) + "@accounts.dudada.invalid",
    });
  } finally {
    await db.close();
  }
}, 30000);
async function hex(value: string) {
  return Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ).toString("hex");
}
