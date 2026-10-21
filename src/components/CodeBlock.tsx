const TOKEN = new RegExp(
  [
    "(\\/\\/.*$)",
    "('(?:[^'\\\\]|\\\\.)*'|\"(?:[^\"\\\\]|\\\\.)*\"|`(?:[^`\\\\]|\\\\.)*`)",
    "(\\b\\d[\\d_]*(?:n)?\\b)",
    "(\\b(?:const|let|var|function|class|export|default|return|await|async|if|else|for|of|in|new|this|true|false|null|undefined|throw|try|catch|while|typeof|BigInt)\\b)",
    "(\\b[A-Za-z_$][\\w$]*(?=\\s*\\())",
  ].join('|'),
  'g',
);

function highlightLine(line: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  TOKEN.lastIndex = 0;
  while ((match = TOKEN.exec(line)) !== null) {
    if (match.index > last) out.push(line.slice(last, match.index));
    const cls = match[1] ? 'c' : match[2] ? 's' : match[3] ? 'n' : match[4] ? 'k' : 'f';
    out.push(
      <span key={key++} className={cls}>
        {match[0]}
      </span>,
    );
    last = match.index + match[0].length;
  }
  out.push(line.slice(last));
  return out;
}

export function CodeBlock({ source }: { source: string }) {
  return (
    <pre className="code">
      {source.split('\n').map((line, i) => (
        <div key={i}>
          {highlightLine(line).length ? highlightLine(line) : ' '}
        </div>
      ))}
    </pre>
  );
}
