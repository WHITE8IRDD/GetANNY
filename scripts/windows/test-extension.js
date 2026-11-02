// Runs the REAL unpacked Chromium extension in a real browser against the
// INSTALLED Electron app and its provisioned authenticated direct bridge.
// Native bootstrap/cold start is exercised separately. No fake browser API.
const { chromium, expect } = require("@playwright/test");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fixtureServer, waitFor, checksum } = require("../../tests/helpers");
const { mediaFixture } = require("../../tests/media-fixture");
const { CHROMIUM_ID } = require("../../src/main/browser-integration/catalog");
const exec = promisify(execFile);
(async () => {
  const [executable, root, browserId = "chromium", browserExecutable] =
    process.argv.slice(2);
  if (!executable || !root)
    throw new Error(
      "Usage: node test-extension.js installed.exe report-folder",
    );
  await fs.mkdir(root, { recursive: true });
  const work = path.join(
    process.env.RUNNER_TEMP || require("node:os").tmpdir(),
    `getanny-browser-${process.pid}`,
  );
  await fs.mkdir(work, { recursive: true });
  const userData = path.join(work, "extension-app-data"),
    cleanups = [];
  const t = {
    after: (fn) => cleanups.push(fn),
    skip: (reason) => {
      throw new Error(reason);
    },
  };
  const fixture = await fixtureServer(t, { size: 1024 * 1024, delay: 5 }),
    media = await mediaFixture(t);
  let app;
  let logs = "";
  const startApp = () => {
    app = spawn(
      executable,
      ["--test-user-data", userData, "--remote-debugging-port=9223"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    app.stdout.on("data", (chunk) => {
      logs += chunk;
    });
    app.stderr.on("data", (chunk) => {
      logs += chunk;
    });
    return app;
  };
  startApp();
  let electron,
    browser,
    externalBrowser,
    externalProcess,
    externalPid,
    externalError,
    baseline,
    failureCategory;
  const closeBrowser = async () => {
    if (externalBrowser) {
      if (externalBrowser.isConnected()) {
        const session = await externalBrowser
          .newBrowserCDPSession()
          .catch(() => null);
        if (session)
          await Promise.race([
            session.send("Browser.close").catch(() => {}),
            new Promise((resolve) => setTimeout(resolve, 1000)),
          ]);
      }
      if (
        externalPid &&
        (externalBrowser.isConnected() ||
          (externalPid === externalProcess.pid &&
            externalProcess.exitCode === null))
      )
        await exec("taskkill.exe", [
          "/pid",
          String(externalPid),
          "/T",
          "/F",
        ]).catch(() => {});
      await externalBrowser.close().catch(() => {});
      externalBrowser = null;
      browser = null;
    } else if (browser) {
      await browser.close();
      browser = null;
    }
  };
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
      "installed Electron remote debugging",
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
      "installed renderer page",
    );
    await page.waitForSelector(".sidebar");
    let invoke = (channel, ...args) =>
      page.evaluate(
        ([channel, args]) => window.getanny.invoke(channel, ...args),
        [channel, args],
      );
    await invoke("settings:set", { key: "firstRunCompleted", value: true });
    await invoke("settings:set", {
      key: "defaultDownloadPath",
      value: path.join(work, "browser-downloads"),
    });
    const prepared = await invoke("browser:prepare", browserId);
    if (browserId === "vivaldi") {
      // Vivaldi exited before CDP with the generic Playwright launch flags.
      // Compare a normal baseline WITHOUT GetANNY before testing its extension;
      // a clean-browser startup failure is unverified, not an invented app pass.
      const openVivaldi = async (withExtension) => {
        externalError = undefined;
        externalProcess = spawn(
          browserExecutable,
          [
            `--user-data-dir=${path.join(work, withExtension ? "chromium-profile" : "vivaldi-baseline-profile")}`,
            "--remote-debugging-port=9224",
            ...(withExtension ? [`--load-extension=${prepared.path}`] : []),
            "about:blank",
          ],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        externalProcess.on("error", (error) => {
          externalError = error;
        });
        for (const stream of [externalProcess.stdout, externalProcess.stderr])
          stream.on("data", (chunk) => {
            logs += "Vivaldi: " + chunk.toString();
          });
        await waitFor(
          async () => {
            if (externalError) throw externalError;
            if (
              externalProcess.exitCode !== null &&
              externalProcess.exitCode !== 0
            )
              throw new Error(
                `Vivaldi exited ${externalProcess.exitCode} before CDP connection`,
              );
            try {
              return (await fetch("http://127.0.0.1:9224/json/version")).ok;
            } catch {
              return false;
            }
          },
          30000,
          "normal headed Vivaldi debugging endpoint",
        );
        externalBrowser = await chromium.connectOverCDP(
          "http://127.0.0.1:9224",
          {
            timeout: 30000,
          },
        );
        const session = await externalBrowser.newBrowserCDPSession();
        externalPid = (
          await session.send("SystemInfo.getProcessInfo")
        ).processInfo.find((info) => info.type === "browser")?.id;
        await session.detach();
        if (!externalPid)
          throw new Error(
            "Vivaldi did not expose a browser PID for safe test-only cleanup",
          );
        browser = externalBrowser.contexts()[0];
      };
      try {
        await openVivaldi(false);
      } catch (error) {
        baseline = { passed: false, error: error.message };
        failureCategory = "browser-baseline";
        throw error;
      }
      baseline = { passed: true, version: externalBrowser.version() };
      await closeBrowser();
      await waitFor(
        async () => {
          try {
            return !(
              await fetch("http://127.0.0.1:9224/json/version", {
                signal: AbortSignal.timeout(700),
              })
            ).ok;
          } catch {
            return true;
          }
        },
        10000,
        "clean Vivaldi baseline closed",
      );
      await openVivaldi(true);
    } else {
      browser = await chromium.launchPersistentContext(
        path.join(work, "chromium-profile"),
        {
          ...(browserExecutable
            ? { executablePath: browserExecutable }
            : { channel: "chromium" }),
          // Vivaldi's Windows headless process crashed before extension loading.
          // Exercise its real headed UI; Chrome also needs its normal approval UI.
          headless: browserId !== "chrome",
          timeout: 60000,
          ignoreDefaultArgs: ["--disable-extensions"],
          args:
            browserId === "chrome"
              ? []
              : [
                  `--disable-extensions-except=${prepared.path}`,
                  `--load-extension=${prepared.path}`,
                ],
        },
      );
    }
    if (browserId === "chrome") {
      // Deliberately use Chrome's supported visible developer-mode controls and
      // native folder picker in a throwaway profile, not removed load flags,
      // policies, signing bypasses or writes to the user's browser profile.
      const manager = await browser.newPage();
      await manager.goto("chrome://extensions/");
      await manager.bringToFront();
      await manager.locator("#devMode").click();
      const session = await browser.browser().newBrowserCDPSession();
      const { processInfo } = await session.send("SystemInfo.getProcessInfo");
      await session.detach();
      const pid = processInfo.find((info) => info.type === "browser")?.id;
      if (!pid)
        throw new Error(
          "Chrome browser process ID unavailable for the normal folder picker",
        );
      await Promise.all([
        exec(
          "powershell.exe",
          [
            "-NoProfile",
            "-STA",
            "-File",
            path.join(__dirname, "select-extension-folder.ps1"),
            "-BrowserPid",
            String(pid),
            "-Directory",
            prepared.path,
          ],
          { timeout: 30000 },
        ),
        manager
          .getByRole("button", { name: "Load unpacked", exact: true })
          .click({ timeout: 10000 }),
      ]);
      await manager.screenshot({
        path: path.join(root, "chrome-developer-consent.png"),
      });
      await manager.close();
    }
    let worker;
    await waitFor(
      () => {
        worker = browser
          .serviceWorkers()
          .find((candidate) => new URL(candidate.url()).host === CHROMIUM_ID);
        return !!worker;
      },
      30000,
      `GetANNY service worker in ${browserId} (not a browser's built-in extension)`,
    );
    const assertId = new URL(worker.url()).host;
    if (assertId !== CHROMIUM_ID)
      throw new Error(`Unexpected extension ID ${assertId}`);
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${CHROMIUM_ID}/popup.html`);
    await expect(popup.locator("#status")).toHaveText(
      /Connected · Secure local bridge/,
      { timeout: 30000 },
    );
    const status = await invoke("browser:status");
    if (
      !status.websocket.sessions.some(
        (session) =>
          session.browserId === browserId &&
          session.transport === "websocket" &&
          session.credential === "provisioned",
      )
    )
      throw new Error(`No verified provisioned direct ${browserId} session`);
    await popup.locator("#url").fill(fixture.url + "/file.bin");
    await popup.locator("#send").click();
    await expect(popup.locator("#message")).toHaveText(
      "Download queued in GetANNY.",
      { timeout: 20000 },
    );
    await waitFor(
      async () =>
        (await invoke("download:get-all")).some(
          (item) =>
            item.url === fixture.url + "/file.bin" &&
            item.status === "completed",
        ),
      20000,
      "browser-origin file download",
    );
    const item = (await invoke("download:get-all")).find(
      (item) => item.url === fixture.url + "/file.bin",
    );
    if (
      checksum(await fs.readFile(item.filePath)) !==
      checksum(fixture.state.data)
    )
      throw new Error("Browser download hash mismatch");

    // Keep the browser and extension worker alive while the installed desktop
    // exits and starts again. The saved browser-scoped capability must reconnect
    // directly; this is the user-visible recovery path after a desktop restart.
    await invoke("app:quit");
    await waitFor(() => app.exitCode !== null, 15000, "desktop restart stop");
    await electron.close().catch(() => {});
    electron = null;
    await waitFor(
      async () => {
        try {
          return !(await fetch("http://127.0.0.1:9223/json/version")).ok;
        } catch {
          return true;
        }
      },
      10000,
      "old desktop debugging endpoint closed",
    );
    startApp();
    await waitFor(
      async () => {
        try {
          return (await fetch("http://127.0.0.1:9223/json/version")).ok;
        } catch {
          return false;
        }
      },
      30000,
      "restarted installed Electron debugging endpoint",
    );
    electron = await chromium.connectOverCDP("http://127.0.0.1:9223");
    page = null;
    await waitFor(
      () => {
        page = electron
          .contexts()[0]
          ?.pages()
          .find((candidate) => candidate.url().startsWith("file://"));
        return !!page;
      },
      30000,
      "restarted installed renderer page",
    );
    await page.waitForSelector(".sidebar");
    invoke = (channel, ...args) =>
      page.evaluate(
        ([invokeChannel, invokeArgs]) =>
          window.getanny.invoke(invokeChannel, ...invokeArgs),
        [channel, args],
      );
    await expect(popup.locator("#status")).toHaveText(
      /Connected · Secure local bridge/,
      { timeout: 45000 },
    );
    await waitFor(
      async () => {
        const restartedStatus = await invoke("browser:status");
        return restartedStatus.websocket.sessions.some(
          (session) =>
            session.browserId === browserId &&
            session.transport === "websocket" &&
            session.credential === "provisioned",
        );
      },
      45000,
      "extension direct reconnect after desktop restart",
    );
    const restartUrl = fixture.url + "/file.bin?desktop-restart=1";
    await popup.locator("#url").fill(restartUrl);
    await popup.locator("#send").click();
    await expect(popup.locator("#message")).toHaveText(
      "Download queued in GetANNY.",
      { timeout: 20000 },
    );
    await waitFor(
      async () =>
        (await invoke("download:get-all")).some(
          (download) =>
            download.url === restartUrl && download.status === "completed",
        ),
      30000,
      "download handoff after automatic direct reconnect",
    );

    const site = await browser.newPage();
    await site.goto(media.server.url + "/watch.html");
    await waitFor(
      () =>
        worker.evaluate(() =>
          Array.from(detected.values()).some((items) =>
            items.some(
              (item) =>
                item.url.includes("/fixture.mp4") ||
                item.url.includes("/video.mp4"),
            ),
          ),
        ),
      15000,
      "content-script media detection",
    );
    const ordinaryUrl = fixture.url + "/file.bin?ordinary-browser=1";
    await site.evaluate(() => {
      document.cookie = "getanny_e2e=browser-cookie; SameSite=Lax";
    });
    await site.evaluate((url) => {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "ordinary-browser.bin";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }, ordinaryUrl);
    await waitFor(
      async () =>
        (await invoke("download:get-all")).some(
          (item) => item.url === ordinaryUrl && item.status === "completed",
        ),
      30000,
      "ordinary browser-download interception",
    );
    const ordinary = (await invoke("download:get-all")).find(
      (item) => item.url === ordinaryUrl,
    );
    if (!ordinary.browserTransferId || ordinary.browserSource !== browserId)
      throw new Error("Ordinary download lacks browser handoff identity");
    if (
      checksum(await fs.readFile(ordinary.filePath)) !==
      checksum(fixture.state.data)
    )
      throw new Error("Ordinary intercepted download hash mismatch");
    const desktopProbe = fixture.state.requests.find(
      (request) =>
        request.url.includes("ordinary-browser=1") &&
        request.range === "bytes=0-0",
    );
    if (!desktopProbe?.cookie?.includes("getanny_e2e=browser-cookie"))
      throw new Error("Ordinary handoff did not forward the browser cookie");
    const remainingNative = await worker.evaluate(async (url) => {
      const downloads = await chrome.downloads.search({});
      return downloads.filter((item) => (item.finalUrl || item.url) === url);
    }, ordinaryUrl);
    if (remainingNative.length)
      throw new Error(
        "Native browser entry was not cancelled and erased after handoff",
      );
    const handoffsLeft = await worker.evaluate(() =>
      Array.from(interceptor.entries.keys()),
    );
    if (handoffsLeft.length)
      throw new Error(
        `Unhandled native handoffs remain: ${handoffsLeft.join(",")}`,
      );
    await popup.locator("#url").fill(media.server.url + "/watch.html");
    await popup.locator("#kind").selectOption("media");
    await popup.locator("#send").click();
    await expect(popup.locator("#message")).toContainText(
      "Media page opened in GetANNY",
    );
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
      "browser-origin media download",
    );
    await page.screenshot({
      path: path.join(root, "installed-extension-download.png"),
    });
    await popup.screenshot({ path: path.join(root, "chromium-popup.png") });
    await fs.writeFile(
      path.join(root, "browser-report.json"),
      JSON.stringify(
        {
          passed: true,
          browser:
            browserId === "chromium"
              ? "Playwright Chromium (not Google Chrome)"
              : browserId,
          browserExecutable: browserExecutable || "Playwright bundled Chromium",
          browserVersion: await browser.browser().version(),
          extensionId: CHROMIUM_ID,
          ...(baseline ? { baseline } : {}),
          installation:
            browserId === "chrome"
              ? "Normal developer-mode UI and native folder picker in a disposable test profile"
              : "Unpacked developer test in a disposable profile",
          headless: !["vivaldi", "chrome"].includes(browserId),
          transport:
            "Browser extension → browser-specific credential → authenticated loopback WebSocket → installed Electron → SQLite/download engine (no native-host lookup)",
          checks: [
            "Extension loads with stable ID",
            "Provisioned direct WebSocket handshake shown in popup and desktop",
            "Extension automatically reconnects directly after installed desktop restart and completes another handoff",
            "Popup-origin HTTP download hash verified",
            "Ordinary browser download intercepted with cookie forwarding, desktop hash verification and native-entry cleanup",
            "Content script detects actual HTML5 media",
            "Popup-origin media request analyzes and downloads through desktop UI",
          ],
          scope:
            "One real browser binary with a new isolated test profile. This is not proof of permanent/store installation or other browser brands.",
          date: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    await closeBrowser();
    await invoke("app:quit");
    await waitFor(() => app.exitCode !== null, 15000, "app quit");
  } catch (error) {
    await fs.writeFile(
      path.join(root, "browser-report.json"),
      JSON.stringify(
        {
          passed: false,
          browser: browserId,
          date: new Date().toISOString(),
          ...(baseline ? { baseline } : {}),
          ...(failureCategory ? { failureCategory } : {}),
          error: error.stack,
          logs,
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    await closeBrowser().catch(() => {});
    if (externalProcess && externalProcess.exitCode === null)
      await exec("taskkill.exe", [
        "/pid",
        String(externalProcess.pid),
        "/T",
        "/F",
      ]).catch(() => {});
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
