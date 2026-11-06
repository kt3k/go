/**
 * Build script: bundles TypeScript with `deno bundle`, compiles Tailwind CSS
 * (with Basecoat) and copies static assets into `dist/`.
 *
 *   deno task build            # production build
 *   deno task dev              # build, watch and serve on http://localhost:8000
 */
import { serveDir } from "@std/http/file-server";

const args = new Set(Deno.args);
const watch = args.has("--watch");
const serve = args.has("--serve");
const DIST = "dist";

async function run(cmd: string[], label: string) {
  const t = performance.now();
  const { code, stderr } = await new Deno.Command(Deno.execPath(), {
    args: cmd,
    stdout: "inherit",
    stderr: "piped",
  }).output();
  if (code !== 0) {
    console.error(new TextDecoder().decode(stderr));
    throw new Error(`${label} failed`);
  }
  console.log(`  ✓ ${label} (${Math.round(performance.now() - t)}ms)`);
}

async function copyDir(src: string, dest: string) {
  await Deno.mkdir(dest, { recursive: true });
  for await (const entry of Deno.readDir(src)) {
    const from = `${src}/${entry.name}`;
    const to = `${dest}/${entry.name}`;
    if (entry.isDirectory) await copyDir(from, to);
    else await Deno.copyFile(from, to);
  }
}

const bundleFlags = watch ? [] : ["--minify"];

async function buildJS() {
  // Run sequentially: on a cold cache, concurrent `deno bundle` processes
  // race while downloading the esbuild binary.
  for (
    const [entry, out] of [["src/ui/main.ts", "main.js"], [
      "src/ui/worker.ts",
      "worker.js",
    ]]
  ) {
    await run(
      [
        "bundle",
        "--platform=browser",
        ...bundleFlags,
        "-o",
        `${DIST}/${out}`,
        entry,
      ],
      out,
    );
  }
}

async function buildCSS() {
  await run(
    [
      "run",
      "-A",
      "npm:@tailwindcss/cli",
      "-i",
      "src/styles.css",
      "-o",
      `${DIST}/styles.css`,
      ...(watch ? [] : ["--minify"]),
    ],
    "styles.css",
  );
}

/**
 * Web fonts are self-hosted (no CDN) so the game works offline and inside
 * an app's WebView. Each entry is a Fontsource stylesheet; its woff2 files
 * are copied to `dist/fonts/` and the @font-face rules (with their
 * unicode-range subsets) are concatenated into `dist/fonts.css`.
 */
const FONTS: [pkg: string, weights: number[]][] = [
  ["inter", [400, 500, 600, 700]],
  ["noto-serif-tc", [400, 700]],
  ["shippori-mincho", [400, 600]],
];

async function buildFonts() {
  const t = performance.now();
  await Deno.mkdir(`${DIST}/fonts`, { recursive: true });
  const out: string[] = [];
  for (const [pkg, weights] of FONTS) {
    const dir = `node_modules/@fontsource/${pkg}`;
    for (const w of weights) {
      const css = await Deno.readTextFile(`${dir}/${w}.css`);
      for (const [rule] of css.matchAll(/@font-face\s*{[^}]*}/g)) {
        const file = rule.match(/url\(\.\/files\/([^)]+\.woff2)\)/)?.[1];
        if (!file) continue;
        await Deno.copyFile(`${dir}/files/${file}`, `${DIST}/fonts/${file}`);
        out.push(
          rule.replace(
            /src:[^;]*;/,
            `src: url(fonts/${file}) format("woff2");`,
          ),
        );
      }
    }
  }
  await Deno.writeTextFile(`${DIST}/fonts.css`, out.join("\n") + "\n");
  console.log(`  ✓ fonts.css (${Math.round(performance.now() - t)}ms)`);
}

async function buildAll() {
  console.log("Building…");
  await Deno.mkdir(DIST, { recursive: true });
  await copyDir("static", DIST);
  await Deno.writeTextFile(`${DIST}/.nojekyll`, "");
  await Promise.all([buildJS(), buildCSS(), buildFonts()]);
}

await buildAll();

if (serve) {
  Deno.serve(
    { port: 8000 },
    (req) => serveDir(req, { fsRoot: DIST, quiet: true }),
  );
}

if (watch) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  for await (const _ of Deno.watchFs(["src", "static"])) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      buildAll().catch((e) => console.error(e.message));
    }, 120);
  }
}
