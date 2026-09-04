# Bugs found during the simplification rounds (logged, not fixed)

Rule: a bug found mid-refactor is recorded here and left alone; the rounds are zero-behavior-change.

| # | Found in | File | What | Evidence |
|---|---|---|---|---|
| 1 | Round 1 | `scripts/bootstrap-agent.mjs:130` | `isSecretLike` JWT pattern is written as `\\.` inside a regex literal, which matches a literal backslash followed by any character, so the JWT branch never matches. The extracted copy in `scripts/lib/extractors.mjs:35` uses the correct `\.`. | `node -e "console.log(/^eyJ[a-zA-Z0-9_-]{20,}\\\\.[a-zA-Z0-9_-]{10,}\\\\.[a-zA-Z0-9_-]{10,}$/.test('eyJ'+'a'.repeat(20)+'.'+'b'.repeat(10)+'.'+'c'.repeat(10)))"` prints `false`. |
| 2 | Round 1 | `app/lib/policy-modes/summary.ts:157`, `app/policies/components/Ledger.tsx:126` | Their private `parseRules` return whatever `JSON.parse` yields when the rules column holds non-object JSON (`null`, a number), so a later `rules.x` throws; the canonical `parseRules` in `app/lib/guardrails/short-list.ts` returns `{}` in that case. Not unified in round 1 because that would change behavior on malformed rows. | Read the four bodies side by side in `docs/simplify/baseline.md` (parseRules cluster). |
