'use client';

import CopyMarkdownButton from './CopyMarkdownButton';

export default function CopyDocsButton() {
  return (
    <CopyMarkdownButton
      href="/api/docs/raw"
      className="mt-4"
    />
  );
}
