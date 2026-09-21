import { readFileSync, existsSync } from "fs";
function check(path) {
  if (!existsSync(path)) { console.log(path, "missing"); return; }
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\n/)) {
    if (!line.startsWith("CONVEX_URL=") && !line.startsWith("CONVEX_DEPLOYMENT=")) continue;
    const eq = line.indexOf("=");
    let k = line.slice(0, eq);
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    console.log(JSON.stringify({ path, key: k, len: v.length, startsHttps: v.startsWith("https://"), startsHttp: v.startsWith("http://"), prefix: v.slice(0, 18) }));
  }
}
check(".env.local");
check("apps/api/.env");
