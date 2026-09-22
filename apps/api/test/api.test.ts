import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KitWorkspace } from "@preptrace/shared";
import { createApp } from "../src/app";
import { startFixtureServer } from "../src/cli/fixtureServer";
import { setConfigForTests } from "../src/config/env";
import { JobRunner } from "../src/jobs/jobRunner";
import { testServices } from "./support/services";

let mongo: MongoMemoryServer;
let site: Awaited<ReturnType<typeof startFixtureServer>>;
let app: ReturnType<typeof createApp>;

const JD = `Senior Backend Engineer — Acme Payments
Location: Remote (Europe)

Requirements
- Strong experience with Node.js and TypeScript
- Deep knowledge of PostgreSQL
- Experience designing distributed systems
- Experience mentoring other engineers

Nice to have
- Experience with Kafka`;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri("preptrace-test"));
  site = await startFixtureServer(0);
  setConfigForTests({ FRONTEND_URL: "http://localhost:3000", BACKEND_URL: "http://localhost:4000" });
  const { services } = testServices({ mode: "evaluation" });
  const runner = new JobRunner(services, 2);
  app = createApp(services, runner);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
  await site.close();
});

async function signup(email: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").send({ name: "Test User", email, password: "correct horse battery" });
  expect(res.status).toBe(201);
  return agent;
}

async function waitForJob(agent: ReturnType<typeof request.agent>, kitId: string) {
  for (let i = 0; i < 200; i++) {
    const s = await agent.get(`/api/kits/${kitId}/generation-status`);
    if (s.body.status && ["completed", "partial", "failed"].includes(s.body.status.status)) return s.body.status;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("job did not finish");
}

async function createKit(agent: ReturnType<typeof request.agent>, jd = JD) {
  const res = await agent.post("/api/kits").send({ jd, companyUrl: `${site.url}/acme/`, days: 5 });
  expect(res.status).toBe(202);
  const status = await waitForJob(agent, res.body.kitId);
  expect(status.status).toMatch(/completed|partial/);
  const kit = (await agent.get(`/api/kits/${res.body.kitId}`)).body.kit as KitWorkspace;
  return kit;
}

describe("health", () => {
  it("GET /health → {status: ok}", async () => {
    const res = await request(app).get("/health");
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("authentication", () => {
  it("register → me → logout → me(401) → login", async () => {
    const agent = await signup("alice@example.com");
    const me = await agent.get("/api/auth/me");
    expect(me.body.user.email).toBe("alice@example.com");
    expect(me.headers["set-cookie"]).toBeUndefined();

    const out = await agent.post("/api/auth/logout");
    expect(out.status).toBe(200);
    expect((await agent.get("/api/auth/me")).status).toBe(401);

    const bad = await agent.post("/api/auth/login").send({ email: "alice@example.com", password: "wrong password" });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("INVALID_CREDENTIALS");
    const ok = await agent.post("/api/auth/login").send({ email: "alice@example.com", password: "correct horse battery" });
    expect(ok.status).toBe(200);
    expect(ok.headers["set-cookie"][0]).toMatch(/pt_session=.*HttpOnly/i);
  });

  it("rejects duplicate emails and weak passwords", async () => {
    await signup("dupe@example.com");
    const again = await request(app).post("/api/auth/register").send({ name: "X", email: "dupe@example.com", password: "another long pass" });
    expect(again.body.error.code).toBe("EMAIL_TAKEN");
    const weak = await request(app).post("/api/auth/register").send({ name: "X", email: "weak@example.com", password: "short" });
    expect(weak.status).toBe(400);
  });

  it("protected endpoints require a session", async () => {
    for (const [method, path] of [["get", "/api/kits"], ["post", "/api/kits"], ["get", "/api/kits/abc"], ["get", "/api/auth/me"]] as const) {
      const res = await request(app)[method](path).send({});
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("AUTH_REQUIRED");
    }
  });

  it("rejects cross-origin state-changing requests", async () => {
    const res = await request(app).post("/api/auth/login").set("Origin", "https://evil.example").send({ email: "a@b.co", password: "x" });
    expect(res.status).toBe(403);
  });
});

describe("kits: generation, isolation, editing, regeneration", () => {
  let owner: ReturnType<typeof request.agent>;
  let kit: KitWorkspace;

  beforeAll(async () => {
    owner = await signup("owner@example.com");
    kit = await createKit(owner);
  });

  it("generated a complete kit via the job pipeline", async () => {
    expect(kit.status).toMatch(/ready|partial/);
    expect(kit.role.requirements.length).toBeGreaterThan(3);
    expect(kit.schedule.days).toHaveLength(5);
    expect(kit.coverage.uncovered_requirement_ids).toEqual([]);
    const status = (await owner.get(`/api/kits/${kit.id}/generation-status`)).body.status;
    expect(status.stages.find((s: { key: string }) => s.key === "check_coverage").status).toBe("done");
    expect(status.events.length).toBeGreaterThan(5);
    const list = await owner.get("/api/kits");
    expect(list.body.kits[0]).toMatchObject({ id: kit.id, company: "Acme Payments" });
  });

  it("another user cannot read, edit or delete the kit (404, not 403)", async () => {
    const mallory = await signup("mallory@example.com");
    expect((await mallory.get(`/api/kits/${kit.id}`)).status).toBe(404);
    expect((await mallory.patch(`/api/kits/${kit.id}/questions/q1`).send({ prompt: "pwned" })).status).toBe(404);
    expect((await mallory.delete(`/api/kits/${kit.id}`)).status).toBe(404);
    expect((await mallory.post(`/api/kits/${kit.id}/practice/events`).send({ itemId: "q1", itemType: "question", confidence: 5 })).status).toBe(404);
    expect((await mallory.get("/api/kits")).body.kits).toEqual([]);
  });

  it("duplicate submission returns the existing kit instead of regenerating", async () => {
    const res = await owner.post("/api/kits").send({ jd: `  ${JD}  `, companyUrl: `${site.url}/acme`, days: 3 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "DUPLICATE_KIT", details: { kitId: kit.id } });
  });

  it("edit + pin + reorder + move category mark state correctly", async () => {
    const tech = kit.questions.filter((q) => q.category === "technical");
    const edited = await owner.patch(`/api/kits/${kit.id}/questions/${tech[0].id}`).send({ prompt: "My rewritten Node.js question", baseVersion: 1 });
    expect(edited.status).toBe(200);
    expect(edited.body.question.meta.edited).toBe(true);

    const pinned = await owner.post(`/api/kits/${kit.id}/questions/${tech[1].id}/pin`).send({});
    expect(pinned.body.question.meta.pinned).toBe(true);

    const stale = await owner.patch(`/api/kits/${kit.id}/questions/${tech[0].id}`).send({ prompt: "x", baseVersion: 1 });
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");

    const bad = await owner.patch(`/api/kits/${kit.id}/questions/${tech[0].id}`).send({ requirement_ids: ["r999"] });
    expect(bad.status).toBe(400);

    const ids = tech.map((q) => q.id).reverse();
    expect((await owner.put(`/api/kits/${kit.id}/questions/order`).send({ ids })).status).toBe(200);
  });

  it("regenerating Technical keeps edited/pinned/manual questions, other categories, the brief and locked schedule days", async () => {
    const before = (await owner.get(`/api/kits/${kit.id}`)).body.kit as KitWorkspace;
    const tech = before.questions.filter((q) => q.category === "technical" && !q.meta.deleted);
    const editedQ = tech.find((q) => q.meta.edited)!;
    const pinnedQ = tech.find((q) => q.meta.pinned)!;
    const plainQ = tech.find((q) => !q.meta.edited && !q.meta.pinned)!;

    const manual = await owner.post(`/api/kits/${kit.id}/questions`).send({ prompt: "Manual: how do you profile a slow Node.js service?", category: "technical", requirement_ids: ["r1"], difficulty: 3 });
    expect(manual.body.question.meta.origin).toBe("manual");

    await owner.patch(`/api/kits/${kit.id}/company-brief`).send({ summary: "My own notes about Acme." });
    const day = await owner.patch(`/api/kits/${kit.id}/schedule/days/2`).send({ focus: "My custom Tuesday", minutes: 90 });
    expect(day.body.day.locked).toBe(true);

    const others = before.questions.filter((q) => q.category !== "technical");
    const regen = await owner.post(`/api/kits/${kit.id}/regenerate/technical`).send({});
    expect(regen.status).toBe(202);
    const status = await waitForJob(owner, kit.id);
    expect(status.status).toBe("completed");

    const after = (await owner.get(`/api/kits/${kit.id}`)).body.kit as KitWorkspace;
    const find = (id: string) => after.questions.find((q) => q.id === id);
    expect(find(editedQ.id)?.prompt).toBe("My rewritten Node.js question");
    expect(find(pinnedQ.id)?.meta.pinned).toBe(true);
    expect(find(manual.body.question.id)?.prompt).toMatch(/^Manual:/);
    expect(find(plainQ.id)).toBeUndefined(); // unprotected generated question replaced
    expect(after.questions.some((q) => q.category === "technical" && q.meta.generation === 1)).toBe(true);
    for (const o of others) expect(find(o.id)).toEqual(o); // other categories untouched
    expect(after.companyBrief.summary).toBe("My own notes about Acme.");
    expect(after.schedule.days[1]).toMatchObject({ focus: "My custom Tuesday", minutes: 90, locked: true });
    expect(after.schedule.days).toHaveLength(5);
    expect(after.coverage.uncovered_requirement_ids).toEqual([]);
    // New IDs never reuse old ones
    const maxBefore = Math.max(...before.questions.map((q) => Number(q.id.slice(1))));
    expect(after.questions.filter((q) => q.meta.generation === 1).every((q) => Number(q.id.slice(1)) > maxBefore)).toBe(true);
  });

  it("regenerating the company brief does not modify questions or the edited schedule, and keeps a revision", async () => {
    const before = (await owner.get(`/api/kits/${kit.id}`)).body.kit as KitWorkspace;
    await owner.post(`/api/kits/${kit.id}/regenerate/company`).send({});
    await waitForJob(owner, kit.id);
    const after = (await owner.get(`/api/kits/${kit.id}`)).body.kit as KitWorkspace;
    expect(after.questions).toEqual(before.questions);
    expect(after.schedule).toEqual(before.schedule);
    expect(after.briefRevisions[0].summary).toBe("My own notes about Acme.");
    const restored = await owner.post(`/api/kits/${kit.id}/company-brief/revisions/0/restore`).send({});
    expect(restored.body.companyBrief.summary).toBe("My own notes about Acme.");
  });

  it("delete is a tombstone: hidden from export, id not reused, schedule pruned, restorable", async () => {
    const k = (await owner.get(`/api/kits/${kit.id}`)).body.kit as KitWorkspace;
    const victim = k.questions.find((q) => !q.meta.deleted && k.schedule.days.some((d) => d.question_ids.includes(q.id)))!;
    await owner.delete(`/api/kits/${kit.id}/questions/${victim.id}`);
    const exported = (await owner.get(`/api/kits/${kit.id}/export`)).body;
    expect(exported.questions.some((q: { id: string }) => q.id === victim.id)).toBe(false);
    expect(exported.schedule.days.flatMap((d: { question_ids: string[] }) => d.question_ids)).not.toContain(victim.id);
    const restored = await owner.post(`/api/kits/${kit.id}/questions/${victim.id}/restore`).send({});
    expect(restored.body.question.id).toBe(victim.id);
  });

  it("schedule regeneration keeps locked days unless replaceEdited is explicitly requested", async () => {
    await owner.post(`/api/kits/${kit.id}/regenerate/schedule`).send({});
    await waitForJob(owner, kit.id);
    let k = (await owner.get(`/api/kits/${kit.id}`)).body.kit as KitWorkspace;
    expect(k.schedule.days[1].focus).toBe("My custom Tuesday");
    await owner.post(`/api/kits/${kit.id}/regenerate/schedule`).send({ replaceEdited: true });
    await waitForJob(owner, kit.id);
    k = (await owner.get(`/api/kits/${kit.id}`)).body.kit as KitWorkspace;
    expect(k.schedule.days[1].focus).not.toBe("My custom Tuesday");
    expect(k.schedule.days).toHaveLength(5);
  });

  it("changing the interview timeline rebuilds the schedule to exactly N days", async () => {
    const res = await owner.patch(`/api/kits/${kit.id}`).send({ days: 9 });
    expect(res.body.kit.schedule.days).toHaveLength(9);
    expect(res.body.kit.input.days).toBe(9);
  });

  it("the export endpoint returns a valid canonical kit", async () => {
    const { validateCanonicalKit } = await import("../src/validation/kitValidator");
    const exported = (await owner.get(`/api/kits/${kit.id}/export`)).body;
    expect(validateCanonicalKit(exported).errors).toEqual([]);
    expect(exported.questions[0].meta).toBeUndefined();
  });

  it("practice: events update readiness; weak spots and repair sessions are deterministic", async () => {
    const before = (await owner.get(`/api/kits/${kit.id}/weak-spots`)).body.readiness;
    expect(before.overall).toBe(0);
    expect(before.weakSpots.length).toBeGreaterThan(0);

    const session = (await owner.post(`/api/kits/${kit.id}/practice`).send({ minutes: 15 })).body.session;
    expect(session.items.length).toBeGreaterThanOrEqual(3);
    for (const item of session.items) {
      const r = await owner.post(`/api/kits/${kit.id}/practice/events`).send({ sessionId: session.id, itemId: item.itemId, itemType: item.itemType, confidence: 4 });
      expect(r.status).toBe(201);
    }
    const mid = (await owner.get(`/api/kits/${kit.id}/weak-spots`)).body.readiness;
    expect(mid.overall).toBeGreaterThan(0);

    const target = mid.weakSpots[0].requirementId;
    const repair = (await owner.post(`/api/kits/${kit.id}/weak-spots/repair`).send({ requirementId: target })).body;
    expect(repair.session.kind).toBe("repair");
    expect(repair.session.followUp?.prompt).toBeTruthy();
    for (const item of repair.session.items) {
      await owner.post(`/api/kits/${kit.id}/practice/events`).send({ sessionId: repair.session.id, itemId: item.itemId, itemType: item.itemType, confidence: 5 });
    }
    const done = (await owner.post(`/api/kits/${kit.id}/weak-spots/repair/${repair.session.id}/complete`).send({ confidence: 4 })).body;
    expect(done.after.confidence).toBe(4);
    expect(done.after.readiness).toBeGreaterThan(done.before.readiness);

    const rejected = await owner.post(`/api/kits/${kit.id}/practice/events`).send({ itemId: "q9999", itemType: "question", confidence: 3 });
    expect(rejected.status).toBe(404);
  });

  it("deleting a kit removes it for the owner", async () => {
    const other = await createKit(owner, `${JD}\n- Experience with Redis`);
    expect((await owner.delete(`/api/kits/${other.id}`)).status).toBe(200);
    expect((await owner.get(`/api/kits/${other.id}`)).status).toBe(404);
  });
});
