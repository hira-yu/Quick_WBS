import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const generatedTargets = [
  resolve(root, "public_html", "assets"),
  resolve(root, "public_html", "index.html"),
];

for (const target of generatedTargets) {
  if (!target.startsWith(resolve(root, "public_html"))) {
    throw new Error(`Refusing to remove unexpected path: ${target}`);
  }
  await rm(target, { recursive: true, force: true });
}
