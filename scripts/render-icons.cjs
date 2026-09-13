// Renders resources/*.svg into the PNG icons the app and the installer use.
// Run with `npm run icons` (uses Electron's Chromium, so no extra tools are needed).
const { app, BrowserWindow } = require('electron')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { dirname, join } = require('node:path')

const root = join(__dirname, '..')
const JOBS = [
  // electron-builder turns this into the .ico for the exe, installer and shortcuts
  ['resources/icon.svg', 'resources/icon.png', 1024],
  ['resources/icon.svg', 'src/renderer/src/assets/logo.png', 128],
  ['resources/tray.svg', 'resources/tray.png', 32],
  ['resources/tray-paused.svg', 'resources/tray-paused.png', 32]
]

/** Loads the SVG into an offscreen transparent window and returns the first full frame as PNG. */
function render(svgBase64, size) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: size,
      height: size,
      useContentSize: true,
      show: false,
      frame: false,
      transparent: true,
      webPreferences: { offscreen: true }
    })
    const timer = setTimeout(() => {
      win.destroy()
      reject(new Error(`timed out rendering ${size}px`))
    }, 20_000)
    let ready = false
    win.webContents.on('paint', (_event, _dirty, image) => {
      if (!ready || image.isEmpty()) return
      ready = false
      clearTimeout(timer)
      const png = image.resize({ width: size, height: size, quality: 'best' }).toPNG()
      win.destroy()
      resolve(png)
    })
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        ready = true
        win.webContents.invalidate()
      }, 400)
    })
    const html =
      '<html><body style="margin:0;background:transparent;overflow:hidden">' +
      `<img src="data:image/svg+xml;base64,${svgBase64}" width="${size}" height="${size}" style="display:block"></body></html>`
    void win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
  })
}

app.disableHardwareAcceleration()
// Destroying a window must not end the run before every icon is written.
app.on('window-all-closed', () => {})
setTimeout(() => {
  console.error('icon rendering took too long')
  app.exit(2)
}, 90_000).unref()

app.whenReady().then(async () => {
  try {
    for (const [src, out, size] of JOBS) {
      const png = await render(readFileSync(join(root, src)).toString('base64'), size)
      mkdirSync(dirname(join(root, out)), { recursive: true })
      writeFileSync(join(root, out), png)
      console.log(`${out}  ${size}×${size}`)
    }
    app.exit(0)
  } catch (err) {
    console.error(err)
    app.exit(1)
  }
})
