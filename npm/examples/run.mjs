import { Sandbox } from "../dist/index.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const sandbox = await Sandbox.create({
  entry: join(__dirname, "hello.mjs"),
  port: 9090,
  inspectorPort: 9099,
});

console.log(`Proxy:     ${sandbox.url}`);
console.log(`Inspector: ${sandbox.inspectorUrl}`);
console.log(`Tunnel:    ${sandbox.tunnelUrl ?? "disabled"}`);
console.log(`\nPress Ctrl+C to stop\n`);

process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await sandbox.close();
  process.exit(0);
});
