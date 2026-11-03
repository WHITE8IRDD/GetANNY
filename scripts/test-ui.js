const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");
const WebSocket = require("ws");
const { fixtureServer, checksum, waitFor } = require("../tests/helpers");
const { mediaFixture } = require("../tests/media-fixture");
const {
  getBridgeIdentity,
} = require("../src/main/browser-integration/BridgeIdentity");
const { CHROMIUM_ID } = require("../src/main/browser-integration/catalog");
const themeCatalog = require("../src/shared/themes.json");
const { launchOptions } = require("./browser-launch");
const base = process.env.GETANNY_PREVIEW_URL || "http://127.0.0.1:5173";
(async () => {
  const cleanup = [];
  const t = {
    after: (fn) => cleanup.push(fn),
    skip: (reason) => {
      throw new Error(reason);
    },
  };
  const fixture = await fixtureServer(t, { size: 8 * 1024 * 1024, delay: 40 });
  const media = await mediaFixture(t);
  const output = path.resolve(".arena/ui-test");
  await fs.mkdir(output, { recursive: true });
  await fs.rm(path.join(output, "report.json"), { force: true });
  const browser = await chromium.launch(await launchOptions());
  const page = await browser.newPage({
    viewport: { width: 1320, height: 860 },
    reducedMotion: "reduce",
  });
  const errors = [];
  let bridgeClient, chromiumClient;
  page.on("pageerror", (error) => errors.push(error.message));
  const invoke = async (channel, ...args) => {
    const response = await page.request.post(base + "/__getanny/invoke", {
      headers: { "X-GetANNY-Preview": "1" },
      data: { channel, args },
    });
    const result = await response.json();
    if (result.error) throw new Error(result.error);
    return result.value;
  };
  const nav = (name) =>
    page
      .locator(".sidebar")
      .getByRole("button", { name: new RegExp(`^${name}`) });
  try {
    await invoke("settings:set", { key: "language", value: "en" });
    await invoke("settings:set", { key: "firstRunCompleted", value: false });
    await invoke("settings:set", { key: "autoStartDownloads", value: true });
    await invoke("settings:set", { key: "scheduleEnabled", value: false });
    await invoke("settings:set", { key: "maxConcurrentDownloads", value: 3 });
    await invoke("settings:set", { key: "completionSoundVolume", value: 40 });
    // Make the real transfer last long enough to actually click Pause even on
    // fast parallel local sockets; no fabricated progress or sleeps as proof.
    await invoke("settings:set", { key: "speedLimit", value: 1024 ** 2 });
    await invoke("settings:set", { key: "theme", value: "graphite" });
    await page.goto(base);
    await expect(
      page.getByRole("heading", { name: "Browser integration", exact: true }),
    ).toBeVisible();
    const pulse = page.locator(".browser-pulse");
    await pulse.click();
    await expect(
      page.getByRole("dialog", { name: "Browser connections" }),
    ).toContainText("No browsers connected");
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Browser connections" }),
    ).toHaveCount(0);
    const cairo = await page.evaluate(async () => {
      const root = document.documentElement;
      const language = root.lang;
      root.lang = "ar";
      await document.fonts.load("16px Cairo", "اللغة العربية");
      const result = {
        loaded: document.fonts.check("16px Cairo", "اللغة العربية"),
        family: getComputedStyle(document.body).fontFamily,
      };
      root.lang = language;
      return result;
    });
    if (!cairo.loaded || !cairo.family.startsWith("Cairo"))
      throw new Error(
        `Bundled Cairo font did not load for Arabic: ${JSON.stringify(cairo)}`,
      );
    await page.screenshot({
      path: path.join(output, "onboarding-1320.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "I’ll set this up later" }).click();
    await nav("All downloads").click();
    const bridgeStatus = await invoke("browser:bridge-status");
    const bridgeIdentity = await getBridgeIdentity(
      path.resolve(".arena/preview-data"),
    );
    bridgeClient = new WebSocket(`ws://127.0.0.1:${bridgeStatus.port}`, {
      origin: `chrome-extension://${CHROMIUM_ID}`,
    });
    await new Promise((resolve, reject) => {
      bridgeClient.once("open", resolve);
      bridgeClient.once("error", reject);
    });
    const bridgeExchange = (message) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Browser pulse handshake timed out.")),
          3000,
        );
        bridgeClient.once("message", (raw) => {
          clearTimeout(timer);
          resolve(JSON.parse(raw));
        });
        bridgeClient.send(JSON.stringify(message));
      });
    await bridgeExchange({
      type: "authenticate",
      token: bridgeIdentity.clientTokens.chrome,
      transport: "websocket",
    });
    await bridgeExchange({
      type: "hello",
      browserId: "chrome",
      extensionId: CHROMIUM_ID,
      version: "ui-smoke",
    });
    await expect(pulse).toHaveClass(/connected/);
    await pulse.click();
    const browserDialog = page.getByRole("dialog", {
      name: "Browser connections",
    });
    await expect(browserDialog.locator(".browser-pulse-session")).toContainText(
      "Google Chrome",
    );
    await expect(browserDialog.locator(".browser-pulse-session")).toContainText(
      "Connected",
    );
    chromiumClient = new WebSocket(`ws://127.0.0.1:${bridgeStatus.port}`, {
      origin: `chrome-extension://${CHROMIUM_ID}`,
    });
    await new Promise((resolve, reject) => {
      chromiumClient.once("open", resolve);
      chromiumClient.once("error", reject);
    });
    const exchangeChromium = (message) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Chromium icon handshake timed out.")),
          3000,
        );
        chromiumClient.once("message", (raw) => {
          clearTimeout(timer);
          resolve(JSON.parse(raw));
        });
        chromiumClient.send(JSON.stringify(message));
      });
    await exchangeChromium({
      type: "authenticate",
      token: bridgeIdentity.clientTokens.chromium,
      transport: "websocket",
    });
    await exchangeChromium({
      type: "hello",
      browserId: "chromium",
      extensionId: CHROMIUM_ID,
      version: "ui-smoke",
    });
    await expect(pulse).toContainText("2 browsers connected");
    await expect(browserDialog.locator(".browser-pulse-session")).toHaveCount(
      2,
    );
    await expect(
      browserDialog.locator('.browser-pulse-session img[alt=""]'),
    ).toBeVisible();
    expect(
      await browserDialog
        .locator('.browser-pulse-session img[alt=""]')
        .evaluate((image) => image.naturalWidth),
    ).toBeGreaterThan(0);
    await page.locator(".sidebar-version").click();
    await expect(browserDialog).toHaveCount(0);
    await pulse.click();
    await page.keyboard.press("Escape");
    await expect(browserDialog).toHaveCount(0);
    await pulse.click();
    chromiumClient.close();
    await expect(browserDialog.locator(".browser-pulse-session")).toHaveCount(
      1,
    );
    await expect(browserDialog.locator(".browser-pulse-session")).toContainText(
      "Google Chrome",
    );
    bridgeClient.close();
    await expect(browserDialog).toContainText("No browsers connected");
    await expect(pulse).not.toHaveClass(/connected/);
    async function add(url, filename) {
      await nav("New download").click();
      await page.getByLabel("Download link", { exact: true }).fill(url);
      await page.getByLabel("File name", { exact: true }).fill(filename);
      await page
        .getByRole("button", { name: "Start download", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    const filename = `HTTP range verification ${Date.now()}.bin`;
    await add(fixture.url + "/file.bin", filename);
    const row = page.getByRole("listitem").filter({
      has: page.getByRole("button", { name: filename, exact: true }),
    });
    await expect(row).toBeVisible();
    await expect(row.getByText("Downloading", { exact: true })).toBeVisible();
    await row
      .getByRole("button", { name: `Pause ${filename}`, exact: true })
      .click();
    await nav("Paused").click();
    await expect(row.getByText("Paused", { exact: true })).toBeVisible();
    await row
      .getByRole("button", { name: `Resume ${filename}`, exact: true })
      .click();
    await nav("All downloads").click();
    await expect(row.getByText("Completed", { exact: true })).toBeVisible({
      timeout: 20000,
    });
    await invoke("settings:set", { key: "speedLimit", value: 0 });
    const items = await invoke("download:get-all"),
      item = items.find((item) => item.filename === filename);
    if (
      checksum(await fs.readFile(item.filePath)) !==
      checksum(fixture.state.data)
    )
      throw new Error("UI download bytes differ");
    const failed = `HTTP failure verification ${Date.now()}.bin`;
    await add(fixture.url + "/missing", failed);
    await nav("Failed").click();
    await expect(
      page.getByRole("listitem").filter({
        has: page.getByRole("button", { name: failed, exact: true }),
      }),
    ).toContainText("HTTP 404");
    const emptyName = `Verified empty file ${Date.now()}.bin`;
    await add(fixture.url + "/empty", emptyName);
    await nav("All downloads").click();
    const emptyRow = page.getByRole("listitem").filter({
      has: page.getByRole("button", { name: emptyName, exact: true }),
    });
    await expect(emptyRow.getByText("Completed", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(emptyRow.locator(".transfer-numbers")).toContainText(
      "0 B / 0 B",
    );
    await expect(emptyRow.locator('[role="progressbar"]')).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    const emptyItem = (await invoke("download:get-all")).find(
      (item) => item.filename === emptyName,
    );
    if ((await fs.stat(emptyItem.filePath)).size !== 0)
      throw new Error("Empty-file completion did not produce zero bytes");
    await nav("Media studio").click();
    await page
      .getByLabel("VIDEO OR AUDIO PAGE")
      .fill(media.server.url + "/watch.html");
    await page
      .getByRole("button", { name: "Analyze link", exact: true })
      .click();
    await expect(page.getByRole("radiogroup")).toBeVisible({ timeout: 25000 });
    await page
      .getByRole("button", { name: "Dismiss notification" })
      .evaluateAll((elements) =>
        elements.forEach((element) => element.click()),
      );
    await page.screenshot({
      path: path.join(output, "media-1320.png"),
      fullPage: true,
    });
    await expect(page.locator(".segment-unavailable")).toContainText(
      "reliable video duration is unavailable",
    );
    await page.getByRole("tab", { name: "Description", exact: true }).click();
    await expect(page.locator(".video-description")).toContainText(
      "Full integration description",
    );
    await page.getByRole("tab", { name: /Thumbnails/ }).click();
    const thumbnail = page.locator(".thumbnail-card").first();
    await expect(thumbnail.locator("img")).toBeVisible();
    await expect
      .poll(() =>
        thumbnail.locator("img").evaluate((image) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
    await thumbnail
      .getByRole("button", { name: "Download", exact: true })
      .click();
    await page.getByRole("tab", { name: /Subtitles/ }).click();
    await expect(page.locator(".subtitle-row")).toContainText("en");
    await page.getByRole("button", { name: "SRT", exact: true }).click();
    await page.getByRole("tab", { name: /Video & Audio/ }).click();
    await page.getByLabel("Include subtitles as a separate download").check();
    await page
      .getByRole("button", { name: "Download video", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "All downloads", exact: true }),
    ).toBeVisible();
    await waitFor(
      async () =>
        (await invoke("download:get-all")).some(
          (item) =>
            item.kind === "media" &&
            item.media?.type !== "subtitle" &&
            item.url === media.server.url + "/watch.html" &&
            item.status === "completed",
        ),
      45000,
      "real media job completion",
    );
    await waitFor(
      async () => {
        const downloads = await invoke("download:get-all");
        const captions = downloads.filter(
          (item) => item.kind === "media" && item.media?.type === "subtitle",
        );
        const thumbnails = downloads.filter(
          (item) => item.kind === "file" && item.category === "Images",
        );
        return (
          captions.length >= 2 &&
          captions.every((item) => item.status === "completed") &&
          thumbnails.some((item) => item.status === "completed")
        );
      },
      45000,
      "independent and alongside subtitles plus thumbnail",
    );
    const completedMedia = await invoke("download:get-all");
    const srt = completedMedia.find(
      (item) =>
        item.media?.type === "subtitle" && item.filename.endsWith(".srt"),
    );
    if (
      !srt ||
      !(await fs.readFile(srt.filePath, "utf8")).includes(
        "GetANNY caption integration",
      )
    )
      throw new Error("Independent SRT output is missing or invalid");
    await expect(
      page
        .locator(
          ".download-row.status-completed .file-icon.video.has-preview img",
        )
        .first(),
    ).toBeVisible({ timeout: 20000 });
    await nav("Settings").click();
    await page
      .getByLabel("Maximum simultaneous downloads", { exact: true })
      .fill("2");
    await page
      .getByLabel("Maximum simultaneous downloads", { exact: true })
      .press("Enter");
    await expect(
      page.getByText("Changes saved", { exact: true }),
    ).toBeVisible();
    if ((await invoke("settings:get-all")).maxConcurrentDownloads !== 2)
      throw new Error("Setting did not persist");
    await page.getByRole("switch", { name: "scheduleEnabled" }).click();
    await expect(
      page.getByRole("switch", { name: "scheduleEnabled" }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(page.getByLabel("Schedule start time")).toBeEnabled();
    await page.getByLabel("Schedule start time").fill("22:15");
    await expect
      .poll(async () => (await invoke("settings:get-all")).scheduleStartMinute)
      .toBe(1335);
    await expect(
      page.getByText("Changes saved", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("switch", { name: "scheduleEnabled" }),
    ).toBeEnabled();
    await page.getByRole("switch", { name: "scheduleEnabled" }).click();
    await expect(
      page.getByRole("switch", { name: "scheduleEnabled" }),
    ).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(async () => (await invoke("settings:get-all")).scheduleEnabled)
      .toBe(false);
    await page
      .getByRole("button", { name: "Application", exact: true })
      .click();
    const volume = page.getByLabel("Completion sound volume", { exact: true });
    await volume.focus();
    await volume.press("ArrowRight");
    await expect
      .poll(
        async () => (await invoke("settings:get-all")).completionSoundVolume,
      )
      .toBe(41);
    await expect(volume).toHaveAttribute("aria-valuetext", "41%");
    await expect(volume).toBeEnabled();
    const volumeSaves = [];
    const recordVolumeSave = (request) => {
      if (!request.url().includes("/__getanny/invoke")) return;
      const body = JSON.parse(request.postData() || "{}");
      if (
        body.channel === "settings:set" &&
        body.args?.[0]?.key === "completionSoundVolume"
      )
        volumeSaves.push(body.args[0].value);
    };
    page.on("request", recordVolumeSave);
    const volumeBox = await volume.boundingBox();
    const volumeY = volumeBox.y + volumeBox.height / 2;
    await page.mouse.move(volumeBox.x + volumeBox.width * 0.4, volumeY);
    await page.mouse.down();
    await page.mouse.move(volumeBox.x + volumeBox.width * 0.85, volumeY, {
      steps: 12,
    });
    await expect
      .poll(async () => Number(await volume.inputValue()))
      .toBeGreaterThan(41);
    const draggedVolume = Number(await volume.inputValue());
    if (volumeSaves.length)
      throw new Error("Volume slider wrote settings before the drag finished");
    await page.mouse.up();
    await expect
      .poll(
        async () => (await invoke("settings:get-all")).completionSoundVolume,
      )
      .toBe(draggedVolume);
    expect(volumeSaves).toEqual([draggedVolume]);
    page.off("request", recordVolumeSave);
    await page.getByLabel("Animations").selectOption("disabled");
    await expect(page.locator("html")).toHaveAttribute(
      "data-motion",
      "disabled",
    );
    await expect(page.getByLabel("Animations")).toBeEnabled();
    await page.getByLabel("Animations").selectOption("standard");
    await expect(page.locator("html")).toHaveAttribute(
      "data-motion",
      "standard",
    );
    await page.screenshot({
      path: path.join(output, "settings-1320.png"),
      fullPage: true,
    });
    await nav("Themes").click();
    // Verify actual CSS tokens, not a screenshot-based accessibility claim.
    // Small muted labels must remain readable even on selected/raised surfaces.
    for (const [theme, colorScheme] of [
      ...Object.values(themeCatalog).map((entry) => [entry.id, entry.mode]),
      ["system", "light"],
      ["system", "dark"],
    ]) {
      await page.emulateMedia({ colorScheme });
      await page
        .locator('.theme-quick-button[aria-label*="Change theme"]')
        .click();
      await page
        .getByRole("menuitemradio", {
          name:
            theme === "system"
              ? "System"
              : themeCatalog.find((entry) => entry.id === theme).name,
          exact: true,
        })
        .click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const failures = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        const luminance = (token) => {
          let hex = style.getPropertyValue(token).trim().replace("#", "");
          if (hex.length === 3)
            hex = [...hex].map((char) => char + char).join("");
          const rgb = [0, 2, 4]
            .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
            .map((value) =>
              value <= 0.04045
                ? value / 12.92
                : ((value + 0.055) / 1.055) ** 2.4,
            );
          return rgb.reduce(
            (sum, value, index) =>
              sum + value * [0.2126, 0.7152, 0.0722][index],
            0,
          );
        };
        const failures = [];
        for (const text of ["--muted", "--secondary", "--text"])
          for (const surface of [
            "--bg",
            "--sidebar",
            "--panel",
            "--raised",
            "--input",
            "--accent-soft",
          ]) {
            const a = luminance(text),
              b = luminance(surface),
              ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            if (!Number.isFinite(ratio) || ratio < 4.5)
              failures.push({ text, surface, ratio });
          }
        return failures;
      });
      if (failures.length)
        throw new Error(
          `${theme} text-token contrast: ${JSON.stringify(failures)}`,
        );
      if (theme === "system")
        await page.screenshot({
          path: path.join(output, `settings-system-${colorScheme}-1320.png`),
          fullPage: true,
        });
    }
    await nav("Themes").click();
    await expect(page.locator(".theme-card")).toHaveCount(
      Object.keys(themeCatalog).length,
    );
    await page
      .getByRole("button", { name: "Apply Nord theme", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "nord");
    await page
      .locator('.theme-quick-button[aria-label*="Change theme"]')
      .click();
    await page
      .getByRole("menuitemradio", { name: "Ocean", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "ocean");
    await page.getByRole("button", { name: "Light", exact: true }).click();
    await expect(page.locator(".theme-card")).toHaveCount(
      Object.values(themeCatalog).filter((entry) => entry.mode === "light")
        .length,
    );
    await page.getByRole("button", { name: "All themes", exact: true }).click();
    await page.screenshot({
      path: path.join(output, "themes-1320.png"),
      fullPage: true,
    });
    await nav("All downloads").click();
    const activeName = `Live transfer verification ${Date.now()}.bin`;
    await add(fixture.url + "/file.bin", activeName);
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(output, "downloads-1320.png"),
      fullPage: true,
    });
    for (const width of [1024, 760, 480]) {
      await page.setViewportSize({ width, height: 800 });
      for (const name of [
        "All downloads",
        "Media studio",
        "Browser integration",
        "Settings",
        "Themes",
      ]) {
        await nav(name).click();
        await page.waitForTimeout(60);
        const overflow = await page
          .locator(".main-content")
          .evaluate((element) => ({
            width: element.clientWidth,
            scroll: element.scrollWidth,
          }));
        if (overflow.scroll > overflow.width + 1)
          throw new Error(
            `${name} overflows at ${width}: ${JSON.stringify(overflow)}`,
          );
        await page.screenshot({
          path: path.join(
            output,
            `${name.replaceAll(" ", "-").toLowerCase()}-${width}.png`,
          ),
          fullPage: true,
        });
      }
    }
    await page.setViewportSize({ width: 1320, height: 860 });
    await nav("All downloads").click();
    // Keyboard dialog trap, Escape, and no accidental submission by Browse/Cancel.
    await nav("New download").click();
    await page
      .getByLabel("Download link", { exact: true })
      .fill(fixture.url + "/file.bin");
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", { name: "Close dialog", exact: true })
      .focus();
    await page.keyboard.press("Shift+Tab");
    await expect(
      dialog.getByRole("button", { name: "Start download", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", { name: "Close dialog", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(nav("New download")).toBeFocused();
    if (errors.length) throw new Error(errors.join("\n"));
    const report = {
      passed: true,
      date: new Date().toISOString(),
      checks: [
        "Browser onboarding renders with honest unknown states",
        "Browser indicator reports a real authenticated connection, shows the official icon and closes by outside click and Escape",
        "Bundled Cairo font loads locally when the renderer language is Arabic",
        "New-download IPC/SSE list updates",
        "HTTP UI pause/resume and hash verification",
        "HTTP 404 failure view",
        "Actual empty-file completion shows verified zero bytes, not unknown size",
        "Real yt-dlp metadata, thumbnails, independent SRT, alongside VTT and video downloads",
        "Video segment selection degrades cleanly when duration metadata is unavailable",
        "Completed-video lazy preview renders from the bounded cache",
        "Validated settings, scheduling and animation modes affect the backend and renderer",
        "Completion volume keyboard changes persist; pointer drags save only once on release",
        "All theme palettes and both system modes meet 4.5:1 text-token contrast on normal, raised and selected surfaces",
        "Themes gallery filtering and top-left quick switcher persist selections",
        "Responsive pages including Themes at 1320,1024,760,480 pixels",
        "Keyboard Escape and focusable dialogs",
        "No uncaught renderer errors",
      ],
      screenshots: (await fs.readdir(output)).filter((file) =>
        file.endsWith(".png"),
      ),
    };
    await fs.writeFile(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    bridgeClient?.terminate();
    chromiumClient?.terminate();
    await browser.close();
    for (const fn of cleanup.reverse()) await fn();
  }
})().catch(async (error) => {
  await fs
    .writeFile(
      path.resolve(".arena/ui-test/report.json"),
      JSON.stringify(
        { passed: false, error: error.stack, date: new Date().toISOString() },
        null,
        2,
      ),
    )
    .catch(() => {});
  console.error(error);
  process.exitCode = 1;
});
