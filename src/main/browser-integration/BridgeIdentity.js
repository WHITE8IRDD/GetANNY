const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { browsers } = require("./catalog");

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const IDENTITY_VERSION = 2;
const newToken = () => randomBytes(32).toString("hex");
const validToken = (value) =>
  typeof value === "string" && TOKEN_PATTERN.test(value);
const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function validIdentity(identity) {
  if (
    !identity ||
    identity.version !== IDENTITY_VERSION ||
    !validToken(identity.nativeToken) ||
    !validToken(identity.recoveryToken) ||
    !identity.clientTokens ||
    typeof identity.clientTokens !== "object"
  )
    return false;
  const tokens = [identity.nativeToken, identity.recoveryToken];
  for (const { id } of browsers) {
    if (!validToken(identity.clientTokens[id])) return false;
    tokens.push(identity.clientTokens[id]);
  }
  return new Set(tokens).size === tokens.length;
}

async function readIdentity(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function migrateIdentity(previous = {}) {
  const used = new Set();
  const unique = (candidate) => {
    if (validToken(candidate) && !used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    let token;
    do token = newToken();
    while (used.has(token));
    used.add(token);
    return token;
  };
  const recoveryToken = unique(
    validToken(previous.recoveryToken)
      ? previous.recoveryToken
      : previous.token,
  );
  const nativeToken = unique(previous.nativeToken);
  const previousClients =
    previous.clientTokens && typeof previous.clientTokens === "object"
      ? previous.clientTokens
      : {};
  const clientTokens = Object.fromEntries(
    browsers.map(({ id }) => [id, unique(previousClients[id])]),
  );
  return {
    version: IDENTITY_VERSION,
    nativeToken,
    recoveryToken,
    clientTokens,
  };
}

/**
 * Load the per-user browser bridge identity.
 *
 * Version 1 used one token for native messaging, direct WebSocket pairing and
 * every browser. Version 2 keeps that token only as a migration/recovery
 * capability, gives the native launcher a separate credential and provisions
 * a different direct credential for every browser package. A token copied out
 * of one prepared extension therefore cannot impersonate another browser.
 *
 * Installer repair and normal startup can briefly overlap. The lock prevents
 * those processes from independently generating credentials and leaving the
 * prepared package out of sync with the running desktop.
 */
async function getBridgeIdentity(userDataPath) {
  const file = path.join(userDataPath, "browser-bridge.json");
  const lockFile = `${file}.lock`;
  const current = await readIdentity(file);
  if (validIdentity(current)) return current;

  await fs.mkdir(userDataPath, { recursive: true });
  let lock;
  for (let attempt = 0; attempt < 160; attempt++) {
    try {
      lock = await fs.open(lockFile, "wx", 0o600);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const completed = await readIdentity(file);
      if (validIdentity(completed)) return completed;
      try {
        const stat = await fs.stat(lockFile);
        if (Date.now() - stat.mtimeMs > 10000)
          await fs.rm(lockFile, { force: true });
      } catch {
        /* another process released the lock */
      }
      await wait(75);
    }
  }
  if (!lock)
    throw new Error(
      "Timed out while another GetANNY process initialized browser credentials.",
    );

  let temporary;
  try {
    // The other process may have completed between our first read and lock.
    const previous = (await readIdentity(file)) || {};
    if (validIdentity(previous)) return previous;
    const identity = migrateIdentity(previous);
    temporary = `${file}.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(identity, null, 2), {
      mode: 0o600,
    });
    await fs.rename(temporary, file);
    temporary = null;
    await fs.chmod(file, 0o600).catch(() => {});
    return identity;
  } finally {
    if (temporary) await fs.rm(temporary, { force: true }).catch(() => {});
    await lock.close().catch(() => {});
    await fs.rm(lockFile, { force: true }).catch(() => {});
  }
}

module.exports = {
  getBridgeIdentity,
  validToken,
  validIdentity,
  migrateIdentity,
  IDENTITY_VERSION,
};
