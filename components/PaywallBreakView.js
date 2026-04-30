'use client'

import { NodeViewWrapper } from '@tiptap/react'

const dashStyle = {
  flex: 1,
  height: 2,
  background:
    'repeating-linear-gradient(90deg, #10b981 0px, #10b981 8px, transparent 8px, transparent 14px)',
}

export default function PaywallBreakView() {
  return (
    <NodeViewWrapper>
      <div
        contentEditable={false}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          margin: '24px 0',
          userSelect: 'none',
          cursor: 'grab',
        }}
      >
        <div style={dashStyle} />
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '5px 12px',
            background: '#ecfdf5',
            border: '1.5px dashed #10b981',
            borderRadius: '999px',
            fontFamily: 'system-ui',
            fontSize: '12px',
            fontWeight: 600,
            color: '#059669',
            whiteSpace: 'nowrap',
          }}
        >
          🔒 Paywall starts here
        </div>
        <div style={dashStyle} />
      </div>
    </NodeViewWrapper>
  )
}
