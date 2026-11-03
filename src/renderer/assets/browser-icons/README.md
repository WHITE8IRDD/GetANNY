# Bundled browser marks

`chromium.png` is the Chromium project product icon, included locally for the browser connection popover:

- Source: https://github.com/chromium/chromium/blob/main/chrome/app/theme/chromium/product_logo_64.png

The other browser marks are bundled as tree-shaken inline SVGs from the existing `react-icons` dependency. No browser icon is fetched at runtime.
