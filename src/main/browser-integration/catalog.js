const CHROMIUM_ID = "oocncjjghijimkajhmdjcgdffkfojpbg";
const FIREFOX_ID = "getanny@getanny.app";
const HOST_ID = "com.getanny.native";
// Native-host registration only. Never writes extension policies or profiles.
const browsers = [
  {
    id: "helium",
    name: "Helium",
    family: "chromium",
    page: "chrome://extensions",
    registry: ["Google\\Chrome"],
    linux: ["helium", "helium-browser"],
    config: "helium",
    mac: "Helium",
    win: [
      "%LOCALAPPDATA%/imput/Helium/Application/chrome.exe",
      "%PROGRAMFILES%/imput/Helium/Application/chrome.exe",
      "%PROGRAMFILES(X86)%/imput/Helium/Application/chrome.exe",
    ],
  },
  {
    id: "chrome",
    name: "Google Chrome",
    family: "chromium",
    page: "chrome://extensions",
    registry: ["Google\\Chrome"],
    linux: ["google-chrome", "google-chrome-stable"],
    config: "google-chrome",
    mac: "Google Chrome",
    win: [
      "%PROGRAMFILES%/Google/Chrome/Application/chrome.exe",
      "%PROGRAMFILES(X86)%/Google/Chrome/Application/chrome.exe",
      "%LOCALAPPDATA%/Google/Chrome/Application/chrome.exe",
    ],
  },
  {
    id: "chromium",
    name: "Chromium",
    family: "chromium",
    page: "chrome://extensions",
    registry: ["Chromium", "Google\\Chrome"],
    linux: ["chromium", "chromium-browser"],
    config: "chromium",
    mac: "Chromium",
    win: [
      "%LOCALAPPDATA%/Chromium/Application/chrome.exe",
      "%PROGRAMFILES%/Chromium/Application/chrome.exe",
      "%PROGRAMFILES(X86)%/Chromium/Application/chrome.exe",
    ],
  },
  {
    id: "brave",
    name: "Brave",
    family: "chromium",
    page: "brave://extensions",
    registry: ["BraveSoftware\\Brave-Browser", "Google\\Chrome"],
    linux: ["brave-browser", "brave-browser-stable"],
    config: "BraveSoftware/Brave-Browser",
    mac: "Brave Browser",
    win: [
      "%PROGRAMFILES%/BraveSoftware/Brave-Browser/Application/brave.exe",
      "%PROGRAMFILES(X86)%/BraveSoftware/Brave-Browser/Application/brave.exe",
      "%LOCALAPPDATA%/BraveSoftware/Brave-Browser/Application/brave.exe",
    ],
  },
  {
    id: "firefox",
    name: "Mozilla Firefox",
    family: "firefox",
    page: "about:debugging#/runtime/this-firefox",
    registry: ["Mozilla"],
    linux: ["firefox"],
    config: ".mozilla",
    mac: "Firefox",
    win: [
      "%PROGRAMFILES%/Mozilla Firefox/firefox.exe",
      "%PROGRAMFILES(X86)%/Mozilla Firefox/firefox.exe",
      "%LOCALAPPDATA%/Mozilla Firefox/firefox.exe",
    ],
  },
  {
    id: "vivaldi",
    name: "Vivaldi",
    family: "chromium",
    page: "vivaldi://extensions",
    registry: ["Vivaldi", "Google\\Chrome"],
    linux: ["vivaldi", "vivaldi-stable"],
    config: "vivaldi",
    mac: "Vivaldi",
    win: [
      "%LOCALAPPDATA%/Vivaldi/Application/vivaldi.exe",
      "%PROGRAMFILES%/Vivaldi/Application/vivaldi.exe",
      "%PROGRAMFILES(X86)%/Vivaldi/Application/vivaldi.exe",
    ],
  },
  {
    id: "opera",
    name: "Opera",
    family: "chromium",
    page: "opera://extensions",
    registry: ["Opera Software\\Opera Stable", "Google\\Chrome"],
    linux: ["opera", "opera-stable"],
    config: "opera",
    mac: "Opera",
    win: [
      "%LOCALAPPDATA%/Programs/Opera/opera.exe",
      "%PROGRAMFILES%/Opera/opera.exe",
      "%PROGRAMFILES(X86)%/Opera/opera.exe",
      "%LOCALAPPDATA%/Programs/Opera/launcher.exe",
      "%PROGRAMFILES%/Opera/launcher.exe",
      "%PROGRAMFILES(X86)%/Opera/launcher.exe",
    ],
  },
  {
    id: "edge",
    name: "Microsoft Edge",
    family: "chromium",
    page: "edge://extensions",
    registry: ["Microsoft\\Edge", "Google\\Chrome"],
    linux: ["microsoft-edge", "microsoft-edge-stable"],
    config: "microsoft-edge",
    mac: "Microsoft Edge",
    win: [
      "%PROGRAMFILES(X86)%/Microsoft/Edge/Application/msedge.exe",
      "%PROGRAMFILES%/Microsoft/Edge/Application/msedge.exe",
    ],
  },
];
function getBrowser(id) {
  const browser = browsers.find((item) => item.id === id);
  if (!browser) throw new Error("Unsupported browser.");
  return browser;
}
module.exports = { browsers, getBrowser, CHROMIUM_ID, FIREFOX_ID, HOST_ID };
