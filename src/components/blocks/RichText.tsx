'use client'

interface RichTextProps {
  content: string
}

export function RichText({ content }: RichTextProps) {
  const isHTML = /<[a-z][\s\S]*>/i.test(content)

  if (isHTML) {
    return (
      <div
        style={{
          fontSize: 15,
          lineHeight: 1.8,
          color: 'var(--text)',
          background: 'var(--surface)',
          borderRadius: 'var(--radius)',
          padding: '24px 32px',
          boxShadow: 'var(--shadow)',
          marginBottom: 24,
        }}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    )
  }

  return (
    <div
      style={{
        fontSize: 15,
        lineHeight: 1.8,
        color: 'var(--text)',
        background: 'var(--surface)',
        borderRadius: 'var(--radius)',
        padding: '24px 32px',
        boxShadow: 'var(--shadow)',
        marginBottom: 24,
        whiteSpace: 'pre-wrap',
      }}
    >
      {content}
    </div>
  )
}
