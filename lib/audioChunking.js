export const TTS_CHUNK_SIZE = 5000 // safe under the 4096 limit, leaves headroom

/**
 * Split plain text for TTS into chunks at natural boundaries.
 * Priority: paragraph (\n\n) → sentence (. ! ?) → word (space) → hard cut.
 */
export function chunkTextForTTS(text, maxSize = TTS_CHUNK_SIZE) {
  const chunks = []
  if (!text || text.length <= maxSize) {
    return text ? [text] : []
  }

  let remaining = text.trim()

  while (remaining.length > maxSize) {
    let chunk = remaining.slice(0, maxSize)

    let splitAt = chunk.lastIndexOf('\n\n')
    if (splitAt < maxSize * 0.5) {
      const sentenceSplits = [
        chunk.lastIndexOf('. '),
        chunk.lastIndexOf('! '),
        chunk.lastIndexOf('? '),
      ]
      splitAt = Math.max(...sentenceSplits)
    }
    if (splitAt < maxSize * 0.5) {
      splitAt = chunk.lastIndexOf(' ')
    }
    if (splitAt <= 0) {
      splitAt = maxSize
    }

    chunks.push(remaining.slice(0, splitAt).trim())
    remaining = remaining.slice(splitAt).trim()
  }

  if (remaining.length > 0) {
    chunks.push(remaining)
  }

  return chunks
}
