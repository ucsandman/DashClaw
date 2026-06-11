import { describe, it, expect } from "vitest";
import { freshStore, seedAcme } from "./helpers.js";
import { addEnvironment, checkPolicy, setPolicyRule } from "../src/service.js";
import { classifySql } from "../src/sql.js";

describe("policy defaults", () => {
  it("allows reads everywhere", () => {
    const store = freshStore();
    seedAcme(store);
    expect(checkPolicy(store, { project: "acme-crm", environment: "production", provider: "github", capability: "read" }).effect).toBe("allow");
  });

  it("allows non-production writes", () => {
    const store = freshStore();
    seedAcme(store);
    expect(checkPolicy(store, { project: "acme-crm", environment: "staging", provider: "vercel", capability: "write" }).effect).toBe("allow");
  });

  it("requires approval for production writes / deploys / env changes", () => {
    const store = freshStore();
    seedAcme(store);
    for (const capability of ["write", "deploy", "env_change"] as const) {
      const d = checkPolicy(store, { project: "acme-crm", environment: "production", provider: "vercel", capability });
      expect(d.effect).toBe("approval_required");
    }
  });

  it("requires approval for live actions regardless of env", () => {
    const store = freshStore();
    seedAcme(store);
    const d = checkPolicy(store, { project: "acme-crm", environment: "staging", provider: "stripe", capability: "write", live: true });
    expect(d.effect).toBe("approval_required");
  });

  it("blocks destructive SQL and deletes everywhere", () => {
    const store = freshStore();
    seedAcme(store);
    expect(checkPolicy(store, { project: "acme-crm", environment: "staging", provider: "supabase", capability: "destructive_sql" }).effect).toBe("block");
    expect(checkPolicy(store, { project: "acme-crm", environment: "staging", provider: "vercel", capability: "delete" }).effect).toBe("block");
  });
});

describe("explicit policy rules override defaults", () => {
  it("an allow rule un-gates a production write", () => {
    const store = freshStore();
    seedAcme(store);
    const before = checkPolicy(store, { project: "acme-crm", environment: "production", provider: "stripe", capability: "write", live: true });
    expect(before.effect).toBe("approval_required");

    setPolicyRule(store, {
      effect: "allow",
      priority: 200,
      description: "Reviewed: allow live Stripe writes for acme-crm production.",
      match: { provider: "stripe", environmentKind: "production", capability: "write" },
    });

    const after = checkPolicy(store, { project: "acme-crm", environment: "production", provider: "stripe", capability: "write", live: true });
    expect(after.effect).toBe("allow");
    expect(after.source).toMatch(/^rule:/);
  });

  it("highest priority rule wins", () => {
    const store = freshStore();
    seedAcme(store);
    setPolicyRule(store, { effect: "allow", priority: 100, match: { provider: "vercel", capability: "deploy" } });
    setPolicyRule(store, { effect: "block", priority: 300, match: { provider: "vercel", capability: "deploy" } });
    const d = checkPolicy(store, { project: "acme-crm", environment: "staging", provider: "vercel", capability: "deploy" });
    expect(d.effect).toBe("block");
  });

  it("rejects invalid runtime rule values before storing them", () => {
    const store = freshStore();
    seedAcme(store);
    const rulesBefore = store.data.policyRules.length;

    expect(() => setPolicyRule(store, { effect: "permit" as any, match: { provider: "vercel" } })).toThrow(/policy effect/i);
    expect(() => setPolicyRule(store, { effect: "allow", match: { provider: "unknown" as any } })).toThrow(/provider/i);
    expect(() => setPolicyRule(store, { effect: "allow", match: { capability: "restart" as any } })).toThrow(/capability/i);

    expect(store.data.policyRules).toHaveLength(rulesBefore);
  });

  it("rejects invalid runtime check values before evaluating policy", () => {
    const store = freshStore();
    seedAcme(store);

    expect(() =>
      checkPolicy(store, {
        project: "acme-crm",
        environment: "staging",
        provider: "unknown" as any,
        capability: "read",
      }),
    ).toThrow(/provider/i);
    expect(() =>
      checkPolicy(store, {
        project: "acme-crm",
        environment: "staging",
        provider: "vercel",
        capability: "restart" as any,
      }),
    ).toThrow(/capability/i);
  });
});

describe("purchase capability clamp", () => {
  it("defaults purchase to approval_required in development, staging, and production", () => {
    const store = freshStore();
    seedAcme(store);
    addEnvironment(store, { project: "acme-crm", name: "dev", kind: "development" });
    for (const environment of ["dev", "staging", "production"]) {
      const d = checkPolicy(store, { project: "acme-crm", environment, provider: "namecheap", capability: "purchase" });
      expect(d.effect).toBe("approval_required");
    }
  });

  it("still requires approval for purchase when an explicit allow rule matches, in dev and production", () => {
    const store = freshStore();
    seedAcme(store);
    addEnvironment(store, { project: "acme-crm", name: "dev", kind: "development" });
    setPolicyRule(store, {
      effect: "allow",
      priority: 500,
      description: "Attempt to un-gate purchases (must be clamped).",
      match: { capability: "purchase" },
    });
    for (const environment of ["dev", "production"]) {
      const d = checkPolicy(store, { project: "acme-crm", environment, provider: "namecheap", capability: "purchase" });
      expect(d.effect).toBe("approval_required");
    }
  });
});

describe("SQL classification", () => {
  it("classifies reads, writes, and destructive statements", () => {
    expect(classifySql("SELECT * FROM users").capability).toBe("read");
    expect(classifySql("select * from users").readOnly).toBe(true);
    expect(classifySql("INSERT INTO users (id) VALUES (1)").capability).toBe("write");
    expect(classifySql("UPDATE users SET x=1").capability).toBe("write");
    expect(classifySql("DROP TABLE users").capability).toBe("destructive_sql");
    expect(classifySql("TRUNCATE users").capability).toBe("destructive_sql");
    expect(classifySql("DELETE FROM users").capability).toBe("destructive_sql");
    expect(classifySql("ALTER TABLE users ADD COLUMN x int").capability).toBe("destructive_sql");
    // Hidden destructive statement after a benign one.
    expect(classifySql("SELECT 1; DROP TABLE users").capability).toBe("destructive_sql");
  });
});
