/**
 * Load the repo-root .env so tests hit the same database as `pnpm dev`.
 * dotenv does not overwrite variables already set, so CI can inject its own.
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "../../.env"), quiet: true });
