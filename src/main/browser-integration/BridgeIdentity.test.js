const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  getBridgeIdentity,
  validToken,
  IDENTITY_VERSION,
} = require("./BridgeIdentity");
const { browsers } = require("./catalog");

test("bridge identity migrates one shared legacy secret to stable isolated credentials", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "getanny-identity-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const legacy = "a".repeat(64);
  await fs.writeFile(
    path.join(dir, "browser-bridge.json"),
    JSON.stringify({ token: legacy }),
  );

  const first = await getBridgeIdentity(dir);
  assert.equal(first.version, IDENTITY_VERSION);
  assert.equal(first.recoveryToken, legacy);
  assert.ok(validToken(first.nativeToken));
  assert.notEqual(first.nativeToken, legacy);
  assert.deepEqual(
    Object.keys(first.clientTokens),
    browsers.map(({ id }) => id),
  );
  assert.equal(
    new Set(Object.values(first.clientTokens)).size,
    browsers.length,
  );
  assert.ok(
    Object.values(first.clientTokens).every(
      (token) => validToken(token) && token !== first.nativeToken,
    ),
  );

  const second = await getBridgeIdentity(dir);
  assert.deepEqual(second, first);
  const persisted = JSON.parse(
    await fs.readFile(path.join(dir, "browser-bridge.json"), "utf8"),
  );
  assert.deepEqual(persisted, first);
});

test("concurrent installer and desktop initialization converge on one identity", async (t) => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "getanny-identity-race-"),
  );
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const identities = await Promise.all(
    Array.from({ length: 12 }, () => getBridgeIdentity(dir)),
  );
  for (const identity of identities) assert.deepEqual(identity, identities[0]);
  assert.equal(
    new Set([
      identities[0].nativeToken,
      identities[0].recoveryToken,
      ...Object.values(identities[0].clientTokens),
    ]).size,
    browsers.length + 2,
  );
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(path.join(dir, "browser-bridge.json"), "utf8"),
    ),
    identities[0],
  );
});
