'use client'
// =============================================================================
//  PreviewPublishControls.js — the Publish affordance on the draft-preview page.
//
//  The preview page used to send an UNPAID draft off to the editor to pay ("Pay
//  & publish in editor"), so clicking publish bounced you into the edit screen.
//  Instead, pay-and-publish happens right here: reuse the SAME PublishPaywallModal
//  the editor uses (so all the tested pay/verify/settle logic is shared, not
//  copied), and once the fee is confirmed — verify-publish-payment has already
//  flipped publish_paid — submit the publish action, which takes the author
//  straight to their live article.
// =============================================================================

import { useRef, useState } from 'react'
import PublishPaywallModal from '@/components/dashboard/PublishPaywallModal'
import { publishDraftPost } from '@/app/dashboard/preview/[id]/actions'

export default function PreviewPublishControls({ postId, publishPaid }) {
  const [showModal, setShowModal] = useState(false)
  const [publishing, setPublishing] = useState(false)
  // A tiny native form carrying just the postId. Submitting it invokes the
  // publishDraftPost server action, which publishes and redirects to the article
  // — so both the already-paid path and the just-paid path share one exit.
  const formRef = useRef(null)

  const submitPublish = () => {
    setPublishing(true)
    formRef.current?.requestSubmit()
  }

  const onPublishClick = () => {
    if (publishing) return
    // Already paid (e.g. a payment that landed but never finished publishing):
    // publish straight away. Otherwise collect the one-time fee first.
    if (publishPaid) submitPublish()
    else setShowModal(true)
  }

  return (
    <div className="preview-publish">
      <form ref={formRef} action={publishDraftPost}>
        <input type="hidden" name="postId" value={postId} />
      </form>
      <button
        type="button"
        className="publishbtn"
        onClick={onPublishClick}
        disabled={publishing}
      >
        {publishing ? 'Publishing…' : publishPaid ? 'Publish' : 'Pay & publish'}
      </button>

      <PublishPaywallModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        postId={postId}
        // The fee is verified (publish_paid set) before this fires, so the publish
        // action will pass its paid-gate and send the author to the live article.
        onPaymentConfirmed={() => {
          setShowModal(false)
          submitPublish()
        }}
      />
    </div>
  )
}
