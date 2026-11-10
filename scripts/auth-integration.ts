import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { postgresAuthStore } from "../apps/api/src/auth/store";
import { hash } from "../apps/api/src/auth/crypto";
import { withDatabase } from "@coago/db";
import { testDatabaseUrl } from "./database";
const url = testDatabaseUrl(),
  store = postgresAuthStore(url),
  now = new Date(),
  token = () => randomBytes(32).toString("hex");
const subject = "U" + randomBytes(16).toString("hex"),
  flowId = await hash(token()),
  state = await hash(token()),
  rateKey = token();
let userId: string | undefined;
try {
  const flow = {
    idHash: flowId,
    stateHash: state,
    nonce: token(),
    verifier: token(),
    expiresAt: new Date(now.getTime() + 600000),
  };
  await store.saveFlow(flow);
  assert.equal(
    await store.takeFlow(flowId, await hash("wrong"), now),
    undefined,
  );
  const consumed = await Promise.all([
    store.takeFlow(flowId, state, now),
    store.takeFlow(flowId, state, now),
  ]);
  assert.equal(consumed.filter(Boolean).length, 1);
  const expired = {
    ...flow,
    idHash: await hash(token()),
    stateHash: await hash(token()),
    expiresAt: new Date(now.getTime() - 1),
  };
  await store.saveFlow(expired);
  assert.equal(
    await store.takeFlow(expired.idHash, expired.stateHash, now),
    undefined,
  );
  const raw1 = token(),
    raw2 = token(),
    expires = new Date(now.getTime() + 86400000),
    identity = { subject, displayName: "Integration test user" };
  const accounts = await Promise.all([
    store.createSession(identity, await hash(raw1), token(), expires, now),
    store.createSession(identity, await hash(raw2), token(), expires, now),
  ]);
  assert.equal(accounts[0].id, accounts[1].id);
  userId = accounts[0].id;
  assert.equal(
    (await store.getSession(await hash(raw1), now))?.user.id,
    userId,
  );
  assert.equal(
    await store.getSession(await hash(raw1), new Date(expires.getTime() + 1)),
    undefined,
  );
  await store.deleteSession(await hash(raw1));
  assert.equal(await store.getSession(await hash(raw1), now), undefined);
  await withDatabase(url, async (_db, client) => {
    const users = await client.query(
      "SELECT count(*) FROM external_identities WHERE provider=$1 AND subject=$2",
      ["line", subject],
    );
    assert.equal(Number(users.rows[0].count), 1);
  });
  for (let i = 0; i < 20; i++)
    assert.equal(await store.allowStart(rateKey, now), true);
  assert.equal(await store.allowStart(rateKey, now), false);
  console.log(
    "PASS auth DB: atomic flow consumption, expiry, concurrent identity creation, hashed sessions, revocation and rate limit",
  );
} finally {
  await withDatabase(url, async (_db, client) => {
    if (userId) await client.query("DELETE FROM users WHERE id=$1", [userId]);
    await client.query("DELETE FROM oauth_flows WHERE id_hash=$1", [flowId]);
    await client.query("DELETE FROM auth_rate_limits WHERE bucket LIKE $1", [
      rateKey + ":%",
    ]);
  });
}
