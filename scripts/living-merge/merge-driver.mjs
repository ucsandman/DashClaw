#!/usr/bin/env node
/**
 * living-merge — the `merge=regenerate` git merge driver.
 *
 * Registered via `git config merge.regenerate.driver` (by install.mjs). Git
 * invokes it for any path mapped to `merge=regenerate` in `.gitattributes`
 * whenever a real (3-way) merge would otherwise conflict. Git passes
 * `%O %A %B %P` (ancestor / ours==target / theirs / pathname) and expects the
 * merged result left in the `%A` file, with exit 0 meaning "resolved, no
 * conflict".
 *
 * This driver is a deliberate NO-OP that KEEPS THE TARGET SIDE (`%A`, the
 * branch being merged into) untouched and exits 0. Generated files are
 * projections of source, so it does not matter which side we keep — the
 * post-merge / post-rewrite hook immediately runs regenerate-all, overwriting
 * `%A` with the correct regeneration of the merged source. The only job here is
 * to guarantee NO conflict markers (`<<<<<<<`) are ever written into a
 * generated file. So: leave `%A` as-is, exit 0.
 *
 * Plain Node + stdlib (no tsx, no deps) so it is robust at merge time — if this
 * driver ever failed to run, generated files would conflict, defeating the
 * whole feature.
 */
process.exit(0);
