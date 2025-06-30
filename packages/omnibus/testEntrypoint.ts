import { $ } from "bun";

console.log("Hi from bun!");

const obj = {
  key: "value"
}
await Bun.write("/config", JSON.stringify(obj, null, 2));

await $`echo "hi from bun shell! Name=${process.env.NAME}" && cat /config && nats-server --version`;
