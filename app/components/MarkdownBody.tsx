import ReactMarkdown from 'react-markdown';

const MD_COMPONENTS = {
  p: ({ children }: any) => <p className="text-sm text-secondary mb-2 leading-relaxed last:mb-0">{children}</p>,
  h1: ({ children }: any) => <h1 className="text-base font-semibold text-secondary mb-2">{children}</h1>,
  h2: ({ children }: any) => <h2 className="text-sm font-semibold text-secondary mb-2">{children}</h2>,
  h3: ({ children }: any) => <h3 className="text-sm font-medium text-secondary mb-1">{children}</h3>,
  code: ({ children, className }: any) => {
    const isBlock = className?.includes('language-');
    if (isBlock) return <code className={className}>{children}</code>;
    return (
      <code className="text-xs text-brand bg-white/[0.06] px-1 py-0.5 rounded">
        {children}
      </code>
    );
  },
  pre: ({ children }: any) => (
    <pre className="text-xs bg-white/[0.04] border border-border rounded-lg p-3 overflow-x-auto mb-2">
      {children}
    </pre>
  ),
  a: ({ href, children }: any) => {
    const isSafe = href && /^(https?:\/\/|\/)/.test(href);
    if (!isSafe) return <span className="text-brand">{children}</span>;
    return (
      <a href={href} className="text-brand hover:underline" target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  ul: ({ children }: any) => <ul className="list-disc list-inside text-sm text-secondary mb-2 space-y-0.5">{children}</ul>,
  ol: ({ children }: any) => <ol className="list-decimal list-inside text-sm text-secondary mb-2 space-y-0.5">{children}</ol>,
  blockquote: ({ children }: any) => (
    <blockquote className="border-l-2 border-zinc-600 pl-3 text-sm text-secondary italic mb-2">
      {children}
    </blockquote>
  ),
  strong: ({ children }: any) => <strong className="font-semibold text-secondary">{children}</strong>,
  em: ({ children }: any) => <em className="italic text-secondary">{children}</em>,
};

interface MarkdownBodyProps {
  content?: string;
  className?: string;
}

export default function MarkdownBody({ content, className = '' }: MarkdownBodyProps) {
  if (!content) return null;
  return (
    <div className={className}>
      <ReactMarkdown components={MD_COMPONENTS}>{content}</ReactMarkdown>
    </div>
  );
}
