import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import 'highlight.js/styles/github-dark.css';

function CopyableCodeBlock({ children, ...props }) {
  const [copied, setCopied] = useState(false);
  const code = React.Children.toArray(children)
    .map((child) => typeof child.props?.children === 'string' ? child.props.children : '')
    .join('');

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="group/code relative my-2 max-w-full overflow-hidden rounded-lg border border-white/10 bg-[#0d1117]">
      <button
        type="button"
        onClick={copyCode}
        className="absolute right-2 top-2 z-10 rounded border border-white/15 bg-black/50 px-2 py-1 text-[10px] text-white/75 opacity-80 hover:text-white"
        aria-label="Copy code block"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre {...props} className="!m-0 max-w-full overflow-x-auto p-3 pr-16 text-xs leading-5 sm:text-[13px]">{children}</pre>
    </div>
  );
}

export default function MarkdownMessage({ children }) {
  return (
    <div className="community-markdown max-w-full break-words text-sm leading-6">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize, rehypeHighlight]}
        components={{
          pre: CopyableCodeBlock,
          p: ({ children: content }) => <p className="my-1.5 last:mb-0">{content}</p>,
          a: ({ href, children: content }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-sky-300 underline underline-offset-2">{content}</a>
          ),
          blockquote: ({ children: content }) => <blockquote className="my-2 border-l-2 border-sky-400/60 pl-3 text-white/70">{content}</blockquote>,
          ul: ({ children: content }) => <ul className="my-2 list-disc space-y-1 pl-5">{content}</ul>,
          ol: ({ children: content }) => <ol className="my-2 list-decimal space-y-1 pl-5">{content}</ol>,
          table: ({ children: content }) => <div className="my-2 max-w-full overflow-x-auto"><table className="min-w-full border-collapse text-xs">{content}</table></div>,
          th: ({ children: content }) => <th className="border border-white/15 bg-white/10 px-2 py-1 text-left">{content}</th>,
          td: ({ children: content }) => <td className="border border-white/10 px-2 py-1">{content}</td>,
        }}
      >
        {children || ''}
      </ReactMarkdown>
    </div>
  );
}