import { Sandbox } from "../mod.ts";

const sandbox = await Sandbox.create({
  entry: new URL("./hello.ts", import.meta.url).pathname,
  port: 9090,
  inspectorPort: 9099,
});

console.log(`Proxy:     ${sandbox.url}`);
console.log(`Inspector: ${sandbox.inspectorUrl}`);
console.log(`\nPress Ctrl+C to stop\n`);

Deno.addSignalListener("SIGINT", async () => {
  console.log("\nShutting down...");
  await sandbox.close();
  Deno.exit(0);
});
