// Real Firefox, its supported TEMPORARY developer add-on API, the installed
// Electron application and provisioned direct bridge. No signature/policy/profile bypass.
const { chromium, expect } = require("@playwright/test");
const { Builder, By } = require("selenium-webdriver");
const firefox = require("selenium-webdriver/firefox");
const { Select } = require("selenium-webdriver/lib/select");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const path = require("node:path");
const { zipSync } = require("fflate");
const { fixtureServer, waitFor, checksum } = require("../../tests/helpers");
const { mediaFixture } = require("../../tests/media-fixture");
const exec = promisify(execFile);
(async () => {
  const [executable, root, firefoxExe, geckoExe] = process.argv.slice(2);
  await fs.mkdir(root, { recursive: true });
  const work = path.join(
      process.env.RUNNER_TEMP,
      `getanny-firefox-${process.pid}`,
    ),
    userData = path.join(work, "app-data");
  await fs.mkdir(work, { recursive: true });
  const cleanups = [],
    t = {
      after: (fn) => cleanups.push(fn),
      skip: (reason) => {
        throw new Error(reason);
      },
    };
  const fixture = await fixtureServer(t, { size: 1024 * 1024 }),
    media = await mediaFixture(t);
  const app = spawn(
    executable,
    ["--test-user-data", userData, "--remote-debugging-port=9223"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let logs = "",
    electron,
    driver;
  app.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  app.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  try {
    await waitFor(
      async () => {
        try {
          return (await fetch("http://127.0.0.1:9223/json/version")).ok;
        } catch {
          return false;
        }
      },
      30000,
      "Electron debugging",
    );
    electron = await chromium.connectOverCDP("http://127.0.0.1:9223");
    let page;
    await waitFor(
      () => {
        page = electron
          .contexts()[0]
          ?.pages()
          .find((page) => page.url().startsWith("file://"));
        return !!page;
      },
      30000,
      "installed renderer",
    );
    await page.waitForSelector(".sidebar");
    const invoke = (channel, ...args) =>
      page.evaluate(
        ([ch, args]) => window.getanny.invoke(ch, ...args),
        [channel, args],
      );
    for (const [key, value] of Object.entries({
      firstRunCompleted: true,
      defaultDownloadPath: path.join(work, "downloads"),
    }))
      await invoke("settings:set", { key, value });
    const prepared = await invoke("browser:prepare", "firefox"),
      entries = {};
    for (const file of await fs.readdir(prepared.path, { recursive: true })) {
      if ((await fs.stat(path.join(prepared.path, file))).isFile())
        entries[file.replaceAll("\\", "/")] = new Uint8Array(
          await fs.readFile(path.join(prepared.path, file)),
        );
    }
    const addon = path.join(work, "temporary-addon.zip");
    await fs.writeFile(addon, zipSync(entries));
    driver = await new Builder()
      .forBrowser("firefox")
      .setFirefoxOptions(
        new firefox.Options().setBinary(firefoxExe).addArguments("-headless"),
      )
      // Firefox 138+ refuses privileged WebDriver context through browser
      // capabilities. Geckodriver's explicit test-process flag is the supported
      // opt-in and applies only to this disposable automation session.
      .setFirefoxService(
        new firefox.ServiceBuilder(geckoExe).addArguments(
          "--allow-system-access",
        ),
      )
      .build();
    await driver.manage().setTimeouts({ pageLoad: 30000, script: 15000 });
    const addonId = await driver.installAddon(addon, true);
    if (addonId !== "getanny@getanny.app")
      throw new Error(`Wrong Firefox add-on ID ${addonId}`);
    await waitFor(
      async () =>
        (await invoke("browser:status")).websocket.sessions.some(
          (session) =>
            session.browserId === "firefox" &&
            session.transport === "websocket" &&
            session.credential === "provisioned",
        ),
      30000,
      "actual Firefox provisioned direct connection",
    );
    // Modern Firefox requires explicit WebDriver system access to inspect an
    // extension page. This flag applies ONLY to our new automation profile; it
    // does not disable add-on signing or grant a production extension permission.
    // Read the UUID Firefox actually assigned, without modifying prefs/files.
    await driver.setContext(firefox.Context.CHROME);
    const uuid = await driver.executeScript(function (id) {
      const prefs = Components.classes[
        "@mozilla.org/preferences-service;1"
      ].getService(Components.interfaces.nsIPrefBranch);
      return JSON.parse(prefs.getStringPref("extensions.webextensions.uuids"))[
        id
      ];
    }, addonId);
    await driver.setContext(firefox.Context.CONTENT);
    if (!/^[0-9a-f-]{36}$/i.test(uuid))
      throw new Error("Firefox did not assign a valid extension UUID");
    const base = `moz-extension://${uuid}`;
    await driver.get(base + "/popup.html");
    const popupHandle = await driver.getWindowHandle();
    await driver.wait(
      async () =>
        (await driver.findElement(By.id("status")).getText()).includes(
          "Connected · Secure local bridge",
        ),
      25000,
    );
    await driver.findElement(By.id("url")).sendKeys(fixture.url + "/file.bin");
    await driver.findElement(By.id("send")).click();
    await driver.wait(
      async () =>
        (await driver.findElement(By.id("message")).getText()) ===
        "Download queued in GetANNY.",
      15000,
    );
    await waitFor(
      async () =>
        (await invoke("download:get-all")).some(
          (item) =>
            item.url === fixture.url + "/file.bin" &&
            item.status === "completed",
        ),
      20000,
      "Firefox file download",
    );
    const item = (await invoke("download:get-all")).find(
      (item) => item.url === fixture.url + "/file.bin",
    );
    if (
      checksum(await fs.readFile(item.filePath)) !==
      checksum(fixture.state.data)
    )
      throw new Error("Firefox download hash mismatch");
    await driver.switchTo().newWindow("tab");
    await driver.get(media.server.url + "/watch.html");
    await driver.findElement(By.css("video"));
    const ordinaryUrl = fixture.url + "/file.bin?ordinary-firefox=1";
    await driver.executeScript(function (url) {
      document.cookie = "getanny_e2e=firefox-cookie; SameSite=Lax";
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "ordinary-firefox.bin";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }, ordinaryUrl);
    await driver.switchTo().window(popupHandle);
    await waitFor(
      () =>
        driver.executeAsyncScript(function (url, done) {
          (async () => {
            const tabs = (await browser.tabs.query({})).filter(
              (tab) => tab.url === url,
            );
            for (const tab of tabs) {
              const result = await browser.runtime.sendMessage({
                type: "detected",
                tabId: tab.id,
              });
              if (result.items.some((item) => item.url.includes("/video.mp4")))
                return true;
            }
            return false;
          })().then(done, () => done(false));
        }, media.server.url + "/watch.html"),
      15000,
      "Firefox content-script media detection",
    );
    await waitFor(
      async () =>
        (await invoke("download:get-all")).some(
          (item) => item.url === ordinaryUrl && item.status === "completed",
        ),
      30000,
      "ordinary Firefox download interception",
    );
    const ordinary = (await invoke("download:get-all")).find(
      (item) => item.url === ordinaryUrl,
    );
    if (!ordinary.browserTransferId || ordinary.browserSource !== "firefox")
      throw new Error("Firefox ordinary download lacks handoff identity");
    if (
      checksum(await fs.readFile(ordinary.filePath)) !==
      checksum(fixture.state.data)
    )
      throw new Error("Firefox intercepted download hash mismatch");
    const desktopProbe = fixture.state.requests.find(
      (request) =>
        request.url.includes("ordinary-firefox=1") &&
        request.range === "bytes=0-0",
    );
    if (!desktopProbe?.cookie?.includes("getanny_e2e=firefox-cookie"))
      throw new Error("Firefox handoff did not forward the browser cookie");
    const remainingNative = await driver.executeAsyncScript(function (
      url,
      done,
    ) {
      browser.downloads.search({}).then(
        (downloads) =>
          done(downloads.filter((item) => (item.finalUrl || item.url) === url)),
        () => done([{ id: "search-failed" }]),
      );
    }, ordinaryUrl);
    if (remainingNative.length)
      throw new Error(
        "Firefox native entry was not cancelled and erased after handoff",
      );
    const urlInput = await driver.findElement(By.id("url"));
    await urlInput.clear();
    await urlInput.sendKeys(media.server.url + "/watch.html");
    await new Select(await driver.findElement(By.id("kind"))).selectByValue(
      "media",
    );
    await driver.findElement(By.id("send")).click();
    await expect(
      page.getByRole("heading", { name: "Media studio", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("radiogroup")).toBeVisible({ timeout: 30000 });
    await page
      .getByRole("button", { name: "Download video", exact: true })
      .click();
    await waitFor(
      async () =>
        (await invoke("download:get-all")).some(
          (item) =>
            item.kind === "media" &&
            item.url === media.server.url + "/watch.html" &&
            item.status === "completed",
        ),
      30000,
      "Firefox media download",
    );
    await fs.writeFile(
      path.join(root, "firefox-popup.png"),
      Buffer.from(await driver.takeScreenshot(), "base64"),
    );
    await page.screenshot({
      path: path.join(root, "installed-firefox-download.png"),
    });
    const capabilities = await driver.getCapabilities();
    await fs.writeFile(
      path.join(root, "browser-report.json"),
      JSON.stringify(
        {
          passed: true,
          browser: "Mozilla Firefox",
          browserVersion: capabilities.get("browserVersion"),
          temporary: true,
          transport:
            "Firefox extension → browser-specific credential → authenticated loopback WebSocket → installed Electron → SQLite/download engine",
          checks: [
            "Actual Firefox supported temporary add-on install",
            "Verified provisioned direct WebSocket handshake in popup and desktop",
            "Popup-origin HTTP download SHA-256 verified",
            "Ordinary Firefox download intercepted with cookie forwarding, desktop hash verification and native-entry cleanup",
            "Actual content-script media detection",
            "Popup-origin media analysis and real desktop download",
          ],
          limitations: [
            "Temporary development installation, not a signed permanent XPI.",
            "Fresh test profile, not a personal browser profile or a store update/restart certification.",
          ],
          date: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    await driver.quit();
    driver = null;
    await invoke("app:quit");
    await waitFor(() => app.exitCode !== null, 15000, "desktop quit");
  } catch (error) {
    await fs.writeFile(
      path.join(root, "browser-report.json"),
      JSON.stringify(
        { passed: false, browser: "Mozilla Firefox", error: error.stack, logs },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    await driver?.quit().catch(() => {});
    await electron?.close().catch(() => {});
    if (app.exitCode === null)
      await exec("taskkill.exe", ["/pid", String(app.pid), "/T", "/F"]).catch(
        () => {},
      );
    await exec(executable, [
      "--unregister-browser-hosts",
      "--test-user-data",
      userData,
      "--quiet",
    ]).catch(() => {});
    for (const cleanup of cleanups.reverse()) await cleanup();
    await fs.rm(work, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
