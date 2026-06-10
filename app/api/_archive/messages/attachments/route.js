export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../../lib/org';
import { getSql } from '../../../../lib/db';
import { getAttachmentWithData } from '../../../../lib/repositories/messagesContext.repository';

export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const attachmentId = searchParams.get('id');

    if (!attachmentId) {
      return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 });
    }

    const attachment = await getAttachmentWithData(sql, orgId, attachmentId);
    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    const buffer = Buffer.from(attachment.data, 'base64');

    // SECURITY: Sanitize filename to prevent header injection via ", \r, \n,
    // or non-printable characters. Force 'attachment' disposition to prevent
    // user-controlled Content-Type from rendering inline HTML at our origin.
    const safeFilename = (attachment.filename || 'download')
      .replace(/["\r\n\x00-\x1f\x7f]/g, '_');

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': attachment.mime_type,
        'Content-Disposition': `attachment; filename="${safeFilename}"`,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Attachment GET error:', error);
    return NextResponse.json({ error: 'An error occurred while fetching attachment' }, { status: 500 });
  }
}
