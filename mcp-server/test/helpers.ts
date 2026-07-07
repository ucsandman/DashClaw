import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage.js";
import { localPaths } from "../src/paths.js";
import { ensureDefaultWorkspace } from "../src/service.js";

/** A Store backed by a fresh temp directory, isolated per test. */
export function freshStore(): Store {
  const home = mkdtempSync(join(tmpdir(), "dashclaw-local-test-"));
  const store = new Store(localPaths(home));
  ensureDefaultWorkspace(store);
  return store;
}
