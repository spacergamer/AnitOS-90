const fs = require("node:fs");
const vm = require("node:vm");

let checked = 0;
for (const filename of ["AnitOS '89/lightfade.html", "public/account.html"]) {
  const html = fs.readFileSync(filename, "utf8");
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  for (const match of scripts) {
    if (/\bsrc\s*=/.test(match[1])) continue;
    const source = match[2].trim();
    if (!source) continue;
    new vm.Script(source, {filename: filename + ":inline-script-" + (++checked)});
  }
}
if (checked < 2) throw new Error("Expected inline scripts in both pages.");
console.log("Validated " + checked + " inline script(s) across the dashboard and account page.");
