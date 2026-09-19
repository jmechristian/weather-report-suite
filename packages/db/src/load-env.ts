import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

export function loadEnv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, ".env.local");
    if (existsSync(candidate)) {
      config({ path: candidate });
      return;
    }
    dir = resolve(dir, "..");
  }
}
