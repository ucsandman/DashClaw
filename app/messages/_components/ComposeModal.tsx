import { useState, useEffect, useRef } from 'react';
import { X, Paperclip, Reply } from 'lucide-react';

const ALLOWED_MIME_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/pdf', 'text/plain', 'text/markdown', 'text/csv', 'application/json',
];
const MAX_SIZE = 5 * 1024 * 1024;
const MAX_FILES = 3;

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface ComposeModalProps {
  show?: boolean;
  onClose: () => void;
  agents?: any[];
  threads?: any[];
  filterAgentId?: string | null;
  isDemo?: boolean;
  onSend: (payload: any) => Promise<void> | void;
  prefill?: any;
}

export default function ComposeModal({ show, onClose, agents, threads, filterAgentId, isDemo, onSend, prefill }: ComposeModalProps) {
  const [to, setTo] = useState('');
  const [type, setType] = useState('info');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [threadId, setThreadId] = useState('');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (show && prefill) {
      setTo(prefill.to || '');
      setSubject(prefill.subject || '');
      setType(prefill.type || 'info');
      setThreadId(prefill.thread_id || '');
    }
  }, [show, prefill]);

  useEffect(() => {
    if (!show) {
      setAttachments([]);
      setAttachError(null);
      setSendError(null);
      setDragging(false);
    }
  }, [show]);

  // Escape closes the modal (the page-level keyboard handler defers to us
  // while the modal is open).
  useEffect(() => {
    if (!show) return;
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [show, onClose]);

  if (!show) return null;

  async function addFiles(files: FileList | File[]) {
    setAttachError(null);
    const remaining = MAX_FILES - attachments.length;
    if (remaining <= 0) {
      setAttachError(`Maximum ${MAX_FILES} attachments`);
      return;
    }
    const toAdd = Array.from(files).slice(0, remaining);
    for (const file of toAdd) {
      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        setAttachError(`Unsupported file type: ${file.type}`);
        continue;
      }
      if (file.size > MAX_SIZE) {
        setAttachError(`"${file.name}" exceeds 5MB limit`);
        continue;
      }
      const data = await readFileAsBase64(file);
      setAttachments(prev => [...prev, { filename: file.name, mime_type: file.type, data, size: file.size }]);
    }
  }

  function removeAttachment(idx: number) {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
    setAttachError(null);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  }

  async function handleSend() {
    if (!body.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      const payload: any = {
        from_agent_id: filterAgentId || 'dashboard',
        body,
        message_type: type,
      };
      if (to) payload.to_agent_id = to;
      if (subject) payload.subject = subject;
      if (urgent) payload.urgent = true;
      if (threadId) payload.thread_id = threadId;
      if (attachments.length > 0) {
        payload.attachments = attachments.map(a => ({
          filename: a.filename,
          mime_type: a.mime_type,
          data: a.data,
        }));
      }

      await onSend(payload);
      setBody('');
      setSubject('');
      setTo('');
      setUrgent(false);
      setThreadId('');
      setAttachments([]);
      onClose();
    } catch (err) {
      // Surface the failure in the still-open modal instead of closing silently
      // — the reply path used to swallow this, so a rejected send looked like a
      // no-op to the operator.
      setSendError((err as Error)?.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  const openThreads = (threads || []).filter(t => t.status === 'open');

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-surface-secondary border border-white/[0.06] rounded-lg w-full max-w-lg mx-4 p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Compose Message</h3>
          <button onClick={onClose} className="text-tertiary hover:text-secondary">
            <X size={16} />
          </button>
        </div>

        {sendError && (
          <div className="mb-3 rounded-md border border-error/40 bg-error-subtle px-3 py-2 text-xs text-error">
            {sendError}
          </div>
        )}

        {prefill?.to && (
          <div className="mb-3 flex items-center gap-1.5 rounded-md border border-brand/20 bg-brand/5 px-3 py-2 text-xs text-secondary">
            <Reply size={12} className="text-brand" aria-hidden="true" />
            Replying to <span className="font-medium text-white">{prefill.to}</span>
            {prefill.type && <span className="text-tertiary">· {prefill.type}</span>}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="text-xs text-tertiary mb-1 block">To</label>
            <select
              value={to}
              onChange={e => setTo(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-surface-primary border border-white/[0.06] rounded-md text-secondary"
            >
              <option value="">All Agents (Broadcast)</option>
              {(agents || []).map(a => (
                <option key={a.agent_id} value={a.agent_id}>{a.agent_id}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-tertiary mb-1 block">Type</label>
              <select
                value={type}
                onChange={e => setType(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-primary border border-white/[0.06] rounded-md text-secondary"
              >
                <option value="info">Info</option>
                <option value="action">Action</option>
                <option value="question">Question</option>
                <option value="lesson">Lesson</option>
                <option value="status">Status</option>
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={urgent}
                  onChange={e => setUrgent(e.target.checked)}
                  className="rounded border-border"
                />
                Urgent
              </label>
            </div>
          </div>
          <div>
            <label className="text-xs text-tertiary mb-1 block">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Optional subject"
              maxLength={200}
              className="w-full px-3 py-2 text-sm bg-surface-primary border border-white/[0.06] rounded-md text-secondary placeholder:text-disabled"
            />
          </div>
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <label className="text-xs text-tertiary mb-1 block">Body</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Message body... (drag & drop files here)"
              maxLength={2000}
              rows={5}
              className={`w-full px-3 py-2 text-sm bg-surface-primary border rounded-md text-secondary placeholder:text-disabled resize-none transition-colors ${
                dragging ? 'border-brand bg-brand/5' : 'border-white/[0.06]'
              }`}
            />
            <div className="flex items-center justify-between mt-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={attachments.length >= MAX_FILES}
                  className="flex items-center gap-1 text-xs text-secondary hover:text-secondary disabled:opacity-40 transition-colors"
                >
                  <Paperclip size={12} /> Attach file
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ALLOWED_MIME_TYPES.join(',')}
                  className="hidden"
                  onChange={e => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; }}
                />
              </div>
              <span className="text-xs text-disabled">{body.length}/2000</span>
            </div>
          </div>

          {/* Attachment chips */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((att, idx) => (
                <span key={idx} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.04] border border-white/[0.06] text-xs text-secondary">
                  <Paperclip size={10} className="text-secondary" />
                  <span className="truncate max-w-[100px]">{att.filename}</span>
                  <span className="text-tertiary">{formatSize(att.size)}</span>
                  <button onClick={() => removeAttachment(idx)} className="text-tertiary hover:text-error ml-0.5">
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {attachError && (
            <div className="text-xs text-error">{attachError}</div>
          )}

          {openThreads.length > 0 && (
            <div>
              <label className="text-xs text-tertiary mb-1 block">Thread (optional)</label>
              <select
                value={threadId}
                onChange={e => setThreadId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-primary border border-white/[0.06] rounded-md text-secondary"
              >
                <option value="">None</option>
                {openThreads.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}
          <button
            onClick={handleSend}
            disabled={!body.trim() || sending || isDemo}
            className="w-full py-2 text-sm font-medium rounded-md bg-brand text-white hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? 'Sending...' : 'Send Message'}
          </button>
        </div>
      </div>
    </div>
  );
}
