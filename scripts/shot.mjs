// Renders one route of the built app off-screen and saves a full-page PNG.
//   npm run shot -- running shots/running.png [--theme dark] [--width 1440] [--delay 2500]
//                   [--out-dir out] [--no-build]
// The route is given without a leading slash ('overview' is the start page, 'activities/12' a detail page).
// Use a separate --out-dir when several builds may run at the same time.
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const positional = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').match(/^--(theme|width|height|delay|out-dir)$/))
const [routeArg = 'overview', out = 'shots/shot.png'] = positional
const route = routeArg === 'overview' ? '/' : '/' + routeArg.replace(/^\/+/, '')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = flag('out-dir', 'out')

if (!args.includes('--no-build')) {
  const cli = resolve(root, 'node_modules/electron-vite/bin/electron-vite.js')
  const build = spawnSync(process.execPath, [cli, 'build', '--outDir', outDir], { stdio: 'inherit' })
  if (build.status !== 0) process.exit(build.status ?? 1)
}

mkdirSync(dirname(resolve(out)), { recursive: true })
const shot = {
  route,
  out: resolve(out),
  width: Number(flag('width', 1440)),
  height: Number(flag('height', 900)),
  theme: flag('theme', 'light'),
  delay: Number(flag('delay', 2500))
}
const electron = require('electron')
const run = spawnSync(electron, [resolve(outDir, 'main/index.js')], {
  stdio: 'inherit',
  env: { ...process.env, FD_SHOT: JSON.stringify(shot) },
  // The app quits itself after capturing; this only stops a stuck run from hanging the terminal.
  timeout: shot.delay + 60_000
})
if (run.error) console.error(`shot did not finish: ${run.error.message}`)
process.exit(run.status ?? 1)
