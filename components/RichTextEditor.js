'use client'

import { useEffect, useMemo, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import Heading from '@tiptap/extension-heading'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { CharacterCount } from '@tiptap/extensions/character-count'
import { POST_BODY_PLAIN_MAX } from '@/lib/postFieldLimits'
import { charCounterClassName } from '@/lib/charCounterClassName'

const BODY_WARN_WITHIN = 10_000

const toolbarBtnBase =
  'rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide transition disabled:pointer-events-none disabled:opacity-40 md:px-2 md:text-xs'

const toolbarBtnOn =
  'border-emerald-600 bg-emerald-100 text-emerald-900 dark:border-emerald-400 dark:bg-emerald-900/40 dark:text-emerald-100'

const toolbarBtnOff =
  'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800'

function ToolbarButton({ active, disabled, onAction, title, children }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault()
        onAction()
      }}
      className={`${toolbarBtnBase} ${active ? toolbarBtnOn : toolbarBtnOff}`}
    >
      {children}
    </button>
  )
}

function ToolbarSeparator() {
  return (
    <span
      className="mx-0.5 hidden h-5 w-px self-center bg-zinc-200 sm:inline-block dark:bg-zinc-700"
      aria-hidden
    />
  )
}

function readPlainCharCount(editor) {
  try {
    return editor.storage.characterCount?.characters() ?? 0
  } catch {
    return 0
  }
}

export default function RichTextEditor({
  content = '',
  onChange,
  id,
  ariaLabelledBy,
  className = '',
  maxPlainTextChars = POST_BODY_PLAIN_MAX,
}) {
  const [initialHtml] = useState(() => content ?? '')
  const [charCount, setCharCount] = useState(0)

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: false,
      }),
      Heading.configure({ levels: [1, 2, 3] }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      CharacterCount.configure({
        limit: maxPlainTextChars,
        mode: 'textSize',
      }),
    ],
    [maxPlainTextChars],
  )

  const editorProps = useMemo(
    () => ({
      attributes: {
        class:
          'tiptap ProseMirror min-h-[240px] px-3 py-2 text-sm text-zinc-900 outline-none focus:outline-none dark:text-zinc-50',
        role: 'textbox',
        'aria-multiline': 'true',
        ...(ariaLabelledBy ? { 'aria-labelledby': ariaLabelledBy } : {}),
        ...(id ? { id } : {}),
      },
    }),
    [ariaLabelledBy, id],
  )

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions,
    content: initialHtml,
    editorProps,
    onUpdate: ({ editor: ed }) => {
      onChange?.(ed.getHTML())
      setCharCount(readPlainCharCount(ed))
    },
  })

  useEffect(() => {
    if (!editor) return
    setCharCount(readPlainCharCount(editor))
  }, [editor])

  const maxLabel = maxPlainTextChars.toLocaleString('en-US')
  const countLabel = charCount.toLocaleString('en-US')
  const counterClass = charCounterClassName(charCount, maxPlainTextChars, BODY_WARN_WITHIN)

  if (!editor) {
    return (
      <div className={className}>
        <div
          className={`overflow-hidden rounded-lg border border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-950`}
        >
          <div className="h-10 animate-pulse border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900" />
          <div className="min-h-[240px] bg-zinc-50/80 dark:bg-zinc-900/50" />
        </div>
        <p className={`mt-1 text-right text-xs tabular-nums ${counterClass}`}>
          {Number(0).toLocaleString('en-US')}/{maxLabel}
        </p>
      </div>
    )
  }

  return (
    <div className={className}>
      <div
        className={`rich-text-editor flex h-[480px] flex-col overflow-hidden rounded-lg border border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-950`}
      >
        <div
          className="z-10 flex flex-wrap items-center gap-1 border-b border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
          role="toolbar"
          aria-label="Formatting"
        >
          <ToolbarButton
            title="Bold"
            active={editor.isActive('bold')}
            onAction={() => editor.chain().focus().toggleBold().run()}
          >
            B
          </ToolbarButton>
          <ToolbarButton
            title="Italic"
            active={editor.isActive('italic')}
            onAction={() => editor.chain().focus().toggleItalic().run()}
          >
            I
          </ToolbarButton>
          <ToolbarButton
            title="Underline"
            active={editor.isActive('underline')}
            onAction={() => editor.chain().focus().toggleUnderline().run()}
          >
            U
          </ToolbarButton>
          <ToolbarSeparator />
          <ToolbarButton
            title="Heading 1"
            active={editor.isActive('heading', { level: 1 })}
            onAction={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          >
            H1
          </ToolbarButton>
          <ToolbarButton
            title="Heading 2"
            active={editor.isActive('heading', { level: 2 })}
            onAction={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            H2
          </ToolbarButton>
          <ToolbarButton
            title="Heading 3"
            active={editor.isActive('heading', { level: 3 })}
            onAction={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          >
            H3
          </ToolbarButton>
          <ToolbarSeparator />
          <ToolbarButton
            title="Bullet list"
            active={editor.isActive('bulletList')}
            onAction={() => editor.chain().focus().toggleBulletList().run()}
          >
            •
          </ToolbarButton>
          <ToolbarButton
            title="Numbered list"
            active={editor.isActive('orderedList')}
            onAction={() => editor.chain().focus().toggleOrderedList().run()}
          >
            1.
          </ToolbarButton>
          <ToolbarButton
            title="Blockquote"
            active={editor.isActive('blockquote')}
            onAction={() => editor.chain().focus().toggleBlockquote().run()}
          >
            “
          </ToolbarButton>
          <ToolbarSeparator />
          <ToolbarButton
            title="Align left"
            active={editor.isActive({ textAlign: 'left' })}
            onAction={() => editor.chain().focus().setTextAlign('left').run()}
          >
            L
          </ToolbarButton>
          <ToolbarButton
            title="Align center"
            active={editor.isActive({ textAlign: 'center' })}
            onAction={() => editor.chain().focus().setTextAlign('center').run()}
          >
            C
          </ToolbarButton>
          <ToolbarButton
            title="Align right"
            active={editor.isActive({ textAlign: 'right' })}
            onAction={() => editor.chain().focus().setTextAlign('right').run()}
          >
            R
          </ToolbarButton>
        </div>
        <div className="flex-1 overflow-y-auto">
          <EditorContent editor={editor} />
        </div>
      </div>
      <p className={`mt-1 text-right text-xs tabular-nums ${counterClass}`}>
        {countLabel}/{maxLabel}
      </p>
    </div>
  )
}
