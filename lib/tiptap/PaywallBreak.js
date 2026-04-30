import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import PaywallBreakView from '@/components/PaywallBreakView'

export const PaywallBreak = Node.create({
  name: 'paywallBreak',
  group: 'block',
  atom: true,
  draggable: true,

  parseHTML() {
    return [{ tag: 'div[data-paywall-break]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-paywall-break': 'true' })]
  },

  addNodeView() {
    if (typeof window === 'undefined') return null
    return ReactNodeViewRenderer(PaywallBreakView)
  },
})
