/**
 * Calibration feedback ingestion (calibration-feedback.ts): the label path
 * from human approval resolutions into controller state.
 *
 *  - approved → benign, denied → dangerous; expired never reaches ingest;
 *  - composed sub-agent ids fold into their base identity family;
 *  - ingest is best-effort (never throws into the approval response);
 *  - batch ingest folds identically to sequential ingests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetState, mockSaveState, mockInsertEvent, mockInsertEvents, mockGetSettings } = vi.hoisted(() => ({
  mockGetState: vi.fn(),
  mockSaveState: vi.fn(),
  mockInsertEvent: vi.fn(),
  mockInsertEvents: vi.fn(),
  mockGetSettings: vi.fn(),
}));

vi.mock('@/lib/repositories/calibration-state.repository', () => ({
  getCalibrationState: mockGetState,
  saveCalibrationState: mockSaveState,
  insertCalibrationEvent: mockInsertEvent,
  insertCalibrationEvents: mockInsertEvents,
}));
vi.mock('@/lib/repositories/settings.repository', () => ({
  getSettings: mockGetSettings,
}));

import { ingestApprovalAdjudication, ingestApprovalAdjudicationBatch } from '@/lib/guard/calibration-feedback';
import { freshCalibrationState, CALIBRATION_DEFAULTS } from '@/lib/guard/calibration';

const sql = () => {
  const fn = () => Promise.resolve([]);
  fn.query = async () => [];
  return fn;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSettings.mockResolvedValue([{ key: 'CALIBRATION_CONTROLLER_MODE', value: 'shadow' }]);
  mockGetState.mockResolvedValue(null);
  mockSaveState.mockResolvedValue(undefined);
  mockInsertEvent.mockResolvedValue(undefined);
  mockInsertEvents.mockResolvedValue(undefined);
});

describe('ingestApprovalAdjudication', () => {
  it('approved at score ≥ θ counts as a false interruption and raises θ', async () => {
    const out = await ingestApprovalAdjudication(sql(), 'org_1', {
      actionId: 'ar_1', agentId: 'agent_x', riskScore: 85, approved: true, source: 'approval',
    });
    expect(out.loss).toBe(1);
    expect(out.thetaAfter).toBeGreaterThan(out.thetaBefore);
    expect(mockSaveState).toHaveBeenCalledTimes(1);
    const saved = mockSaveState.mock.calls[0][2];
    expect(saved.labeledTotal).toBe(1);
    expect(saved.labeledBenign).toBe(1);
    expect(mockInsertEvent).toHaveBeenCalledWith(expect.anything(), 'org_1', expect.objectContaining({
      actionId: 'ar_1', label: 'benign', loss: 1, source: 'approval',
    }));
  });

  it('denied lowers θ (tighten) and feeds the agent e-process', async () => {
    const out = await ingestApprovalAdjudication(sql(), 'org_1', {
      actionId: 'ar_2', agentId: 'agent_x', riskScore: 85, approved: false, source: 'approval',
    });
    expect(out.loss).toBe(0);
    expect(out.thetaAfter).toBeLessThan(out.thetaBefore);
    const saved = mockSaveState.mock.calls[0][2];
    expect(saved.agents['agent_x'].denied).toBe(1);
    expect(saved.agents['agent_x'].e).toBeGreaterThan(1);
  });

  it('composed sub-agent ids fold into the base identity family', async () => {
    await ingestApprovalAdjudication(sql(), 'org_1', {
      actionId: 'ar_3', agentId: 'agent_x:researcher', riskScore: 85, approved: false, source: 'approval',
    });
    const saved = mockSaveState.mock.calls[0][2];
    expect(saved.agents['agent_x']).toBeTruthy();
    expect(saved.agents['agent_x:researcher']).toBeUndefined();
  });

  it('never throws — a dead repository yields null and a warning only', async () => {
    mockSaveState.mockRejectedValue(new Error('db down'));
    const out = await ingestApprovalAdjudication(sql(), 'org_1', {
      actionId: 'ar_4', agentId: null, riskScore: 50, approved: true, source: 'approval',
    });
    expect(out).toBeNull();
  });
});

describe('ingestApprovalAdjudicationBatch', () => {
  it('folds identically to sequential single ingests', async () => {
    const inputs = [
      { actionId: 'a1', agentId: 'ag', riskScore: 85, approved: true, source: 'bulk_approval' },
      { actionId: 'a2', agentId: 'ag', riskScore: 90, approved: false, source: 'bulk_approval' },
      { actionId: 'a3', agentId: 'ag2', riskScore: 82, approved: true, source: 'bulk_approval' },
    ];

    // Sequential: thread state through mockGetState.
    let seqState = null;
    mockGetState.mockImplementation(async () => seqState);
    mockSaveState.mockImplementation(async (_sql, _org, s) => { seqState = s; });
    for (const input of inputs) {
      await ingestApprovalAdjudication(sql(), 'org_1', input);
    }
    const sequentialFinal = seqState;

    // Batch: fresh start, single fold.
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue([]);
    mockGetState.mockResolvedValue(null);
    mockSaveState.mockResolvedValue(undefined);
    mockInsertEvents.mockResolvedValue(undefined);
    const n = await ingestApprovalAdjudicationBatch(sql(), 'org_1', inputs);
    expect(n).toBe(3);
    const batchFinal = mockSaveState.mock.calls[0][2];

    // Timestamps aside (alarmed_at is null throughout here), the folds agree.
    expect(batchFinal.theta).toBeCloseTo(sequentialFinal.theta, 10);
    expect(batchFinal.labeledTotal).toBe(sequentialFinal.labeledTotal);
    expect(batchFinal.lossSum).toBe(sequentialFinal.lossSum);
    expect(Object.keys(batchFinal.agents).sort()).toEqual(Object.keys(sequentialFinal.agents).sort());
    expect(mockInsertEvents).toHaveBeenCalledTimes(1);
    expect(mockInsertEvents.mock.calls[0][2]).toHaveLength(3);
  });

  it('empty input is a no-op', async () => {
    const n = await ingestApprovalAdjudicationBatch(sql(), 'org_1', []);
    expect(n).toBe(0);
    expect(mockGetSettings).not.toHaveBeenCalled();
  });

  it('starting θ is the controller default', () => {
    expect(freshCalibrationState().theta).toBe(CALIBRATION_DEFAULTS.theta0);
  });
});
