import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const outdir = path.join(root, 'site-explorer')
const entrypoint = 'pages/demos/explorer.html'

const result = Bun.spawnSync(
  ['bun', 'build', entrypoint, '--outdir', outdir],
  {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
  },
)

if (result.exitCode !== 0) {
  process.exit(result.exitCode)
}

const builtHtmlPath = await resolveBuiltHtmlPath('explorer.html')
const targetPath = path.join(outdir, 'index.html')
let html = await readFile(builtHtmlPath, 'utf8')
html = html.replace('<html lang="en">', '<html lang="en" data-app="pretext-explorer">')

await mkdir(path.dirname(targetPath), { recursive: true })
await writeFile(targetPath, html)
if (builtHtmlPath !== targetPath) await rm(builtHtmlPath)

async function resolveBuiltHtmlPath(relativePath: string): Promise<string> {
  const candidates = [
    path.join(outdir, relativePath),
    path.join(outdir, 'pages', 'demos', relativePath),
  ]
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]!
    if (await Bun.file(candidate).exists()) return candidate
  }
  throw new Error(`Built HTML not found for ${relativePath}`)
}
