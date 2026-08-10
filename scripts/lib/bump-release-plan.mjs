/**
 * bump-release-plan.mjs — mechanical version advance for contracts/sdk/release-plan.json.
 *
 * The contract convergence gate (check-sdk-surface.mjs) hard-fails CI when
 * node.current_version / python.current_version fall behind the SDK manifests,
 * which happens on EVERY `version:set` if the plan is bumped by hand. Both
 * v5.15.0 and v5.16.0 shipped, failed CI on exactly this, and needed a fix
 * commit. This module makes the bump part of `version:set` itself.
 *
 * Pure: takes the JSON text and the new version, returns the updated text.
 * current_version fields are always advanced. The old version number is also
 * substituted inside the prose `reason` strings so a platform-only release
 * stays coherent without hand-editing; when SDK source actually changed, the
 * reasons still need a human rewrite — the caller prints that reminder.
 */
export function bumpReleasePlan(jsonText, version) {
  const plan = JSON.parse(jsonText);
  const prior =
    plan.node?.current_version || plan.python?.current_version || null;

  for (const side of ['node', 'python']) {
    if (plan[side] && typeof plan[side] === 'object') {
      plan[side].current_version = version;
    }
  }

  if (prior && prior !== version) {
    const priorPattern = new RegExp(
      prior.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'g'
    );
    const substitute = (obj) => {
      if (typeof obj?.reason === 'string') {
        obj.reason = obj.reason.replace(priorPattern, version);
      }
    };
    substitute(plan.node);
    substitute(plan.python);
    substitute(plan);
  }

  return `${JSON.stringify(plan, null, 2)}\n`;
}
