const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync("AnitOS '89/lightfade.html", "utf8");
const scripts = [...html.matchAll(/<script\\b([^>]*)>([\\s\\S]*?)<\\/script>/gi)];
let checked = 0;
for (const match of scripts) {
  if (/\\bsrc\\s*=/.test(match[1])) continue;
  const source = match[2].trim();
  if (!source) continue;
  new vm.Script(source, {filename: "AnitOS '89/lightfade.html:inline-script-" + (++checked)});
}
console.log("Validated " + checked + " inline script(s).");
