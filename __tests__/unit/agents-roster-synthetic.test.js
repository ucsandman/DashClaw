import { describe, expect, it, vi } from 'vitest';
import { listAgentsForOrg } from '../../app/lib/repositories/agents.repository.js';

describe('listAgentsForOrg — synthetic agent filtering', () => {
  it('excludes smoke agents by default, includes with includeSynthetic', async () => {
    const rows = [
      { agent_id: 'smoke-u-mr7cb07m', agent_name: 'smoke-u-mr7cb07m', action_count: 12, last_active: null },
      { agent_id: 'openclaw', agent_name: 'openclaw', action_count: 2329, last_active: null },
    ];
    const sqlFn = (strings, ...v) => Promise.resolve([]); // template-tag calls (presence etc.)
    sqlFn.query = vi.fn((text) => Promise.resolve(text.includes('FROM action_records') ? rows : []));
    const def = await listAgentsForOrg(sqlFn, 'org_default');
    expect(def.map((a) => a.agent_id)).toEqual(['openclaw']);
    const all = await listAgentsForOrg(sqlFn, 'org_default', { includeSynthetic: true });
    expect(all.map((a) => a.agent_id).sort()).toEqual(['openclaw', 'smoke-u-mr7cb07m']);
  });
});
