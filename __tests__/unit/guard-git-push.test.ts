import { describe, it, expect } from 'vitest';
import { parseGitPush, branchMatches, gitPushPredicateMatches, DEFAULT_PROTECTED_BRANCHES } from '../../app/lib/guard/git-push';

describe('parseGitPush', () => {
  it('returns null when there is no git push', () => {
    expect(parseGitPush('Bash: git log --date=format:%Y')).toBeNull();
    expect(parseGitPush('Bash: npm test')).toBeNull();
    expect(parseGitPush(undefined)).toBeNull();
  });
  it('detects --force, -f, --force-with-lease and +refspec', () => {
    expect(parseGitPush('Bash: git push --force origin main')).toEqual({ force: true, branch: 'main', remote: 'origin' });
    expect(parseGitPush('git push -f origin feature/x')).toEqual({ force: true, branch: 'feature/x', remote: 'origin' });
    expect(parseGitPush('git push --force-with-lease=main origin HEAD:main')).toMatchObject({ force: true, branch: 'main' });
    expect(parseGitPush('git push origin +main')).toMatchObject({ force: true, branch: 'main' });
  });
  it('treats --delete / -d / :branch as force (destructive)', () => {
    expect(parseGitPush('git push origin --delete main')).toMatchObject({ force: true, branch: 'main' });
    expect(parseGitPush('git push origin :release/1.2')).toMatchObject({ force: true, branch: 'release/1.2' });
  });
  it('a plain push is not force and reads the branch', () => {
    expect(parseGitPush('Bash: git push origin feature/x')).toEqual({ force: false, branch: 'feature/x', remote: 'origin' });
    expect(parseGitPush('Bash: git push')).toEqual({ force: false, branch: null, remote: null });
  });
  it('finds git push inside && chains and wrappers', () => {
    expect(parseGitPush('cd repo && git add -A && git push --force origin main')).toMatchObject({ force: true, branch: 'main' });
    expect(parseGitPush('rtk git push -f origin master')).toMatchObject({ force: true, branch: 'master' });
  });
});

describe('branchMatches', () => {
  it('matches exact names and glob prefixes', () => {
    expect(branchMatches('main', DEFAULT_PROTECTED_BRANCHES)).toBe(true);
    expect(branchMatches('release/2.0', DEFAULT_PROTECTED_BRANCHES)).toBe(true);
    expect(branchMatches('feature/x', DEFAULT_PROTECTED_BRANCHES)).toBe(false);
  });
  it('treats an unknown branch as protected (conservative)', () => {
    expect(branchMatches(null, DEFAULT_PROTECTED_BRANCHES)).toBe(true);
  });
});

describe('gitPushPredicateMatches', () => {
  const pred = { force: true, branches: [...DEFAULT_PROTECTED_BRANCHES] };
  it('holds a force-push over main, not over a feature branch, not a plain push', () => {
    expect(gitPushPredicateMatches(pred, 'Bash: git push --force origin main')).toBe(true);
    expect(gitPushPredicateMatches(pred, 'Bash: git push --force origin feature/x')).toBe(false);
    expect(gitPushPredicateMatches(pred, 'Bash: git push origin main')).toBe(false);
    expect(gitPushPredicateMatches(pred, 'Bash: rm -rf build')).toBe(false);
  });
  it('{force:true} with no branches matches every force-push', () => {
    expect(gitPushPredicateMatches({ force: true }, 'git push -f origin feature/x')).toBe(true);
  });
});
