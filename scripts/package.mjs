import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
export const runtimeFiles = [
  "home.html", "LICENSE", "_locales/ja/messages.json",
  "src/common.js", "src/platform/browser-api.js", "src/routing.js",
  "src/background.js", "src/content.js", "src/home.js", "src/home.css",
  "icons/icon16.png", "icons/icon32.png", "icons/icon48.png", "icons/icon128.png"
];
export async function createManifest(browser) {
  if (!["chromium", "firefox"].includes(browser)) throw new Error("対象はchromiumまたはfirefoxを指定してください。");
  const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
  if (browser === "firefox") {
    const override = JSON.parse(await fs.readFile(path.join(root, "manifests/firefox.json"), "utf8"));
    Object.assign(manifest, override);
  }
  return manifest;
}
export async function buildPackage(browser, outputRoot = path.join(root, "dist")) {
  const manifest = await createManifest(browser);
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("版番号を確認してください。");
  const parent = path.resolve(outputRoot);
  const output = path.resolve(parent, `HikikomoriNote-${manifest.version}-${browser}`);
  // 再生成時に削除する対象が出力先直下の成果物だけであることを確認。
  if (path.dirname(output) !== parent) throw new Error("出力先の範囲外です。");
  await fs.mkdir(parent, { recursive: true });
  const existing = await fs.lstat(output).catch(error => { if (error.code !== "ENOENT") throw error; });
  if (existing?.isSymbolicLink()) throw new Error("リンクになっている出力先は使用できません。");
  await fs.rm(output, { recursive: true, force: true });
  for (const file of runtimeFiles) {
    const destination = path.join(output, file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(root, file), destination);
  }
  await fs.writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.copyFile(path.join(root, `docs/install-${browser}.md`), path.join(output, "INSTALL.md"));
  return output;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const output = await buildPackage(process.argv[2] ?? "firefox");
  process.stdout.write(output);
}
