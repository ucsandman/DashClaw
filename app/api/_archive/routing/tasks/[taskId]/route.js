export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../../../lib/org';
import { getSql } from '../../../../../lib/db';
import { deleteTask, getTask } from '../../../../../lib/repositories/routing.repository';

export async function DELETE(request, { params }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { taskId } = await params;

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    const deleted = await deleteTask(sql, orgId, taskId);
    if (!deleted) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Task DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }
}

export async function GET(request, { params }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { taskId } = await params;

    const task = await getTask(sql, orgId, taskId);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    return NextResponse.json({ task });
  } catch (error) {
    console.error('Task GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch task' }, { status: 500 });
  }
}
