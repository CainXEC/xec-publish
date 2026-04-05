'use client'

import { QRCodeSVG } from 'qrcode.react'

export default function PaymentQrCode({ value }) {
  if (!value) return null

  return (
    <div className="flex flex-col items-center gap-2">
      <QRCodeSVG value={value} size={192} level="M" marginSize={4} />
    </div>
  )
}

