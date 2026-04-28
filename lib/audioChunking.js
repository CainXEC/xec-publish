export const TTS_CHUNK_SIZE = 4500 // byte limit safety buffer under Google TTS 5000-byte cap

function getByteLength(str) {
  return new TextEncoder().encode(str).length
}

function splitChunkByByteLength(chunk, maxSize) {
  const parts = []
  let remaining = String(chunk ?? '').trim()

  while (remaining && getByteLength(remaining) > maxSize) {
    let end = 1
    while (end <= remaining.length && getByteLength(remaining.slice(0, end)) <= maxSize) {
      end += 1
    }
    end = Math.max(1, end - 1)
    parts.push(remaining.slice(0, end).trim())
    remaining = remaining.slice(end).trim()
  }

  if (remaining) parts.push(remaining)
  return parts
}

function findPreferredSplitAt(candidate, maxSize) {
  const isHealthyBoundary = (idx) => {
    if (idx <= 0) return false
    return getByteLength(candidate.slice(0, idx)) >= maxSize * 0.5
  }

  let splitAt = candidate.lastIndexOf('\n\n')
  if (!isHealthyBoundary(splitAt)) {
    const sentenceSplits = [
      candidate.lastIndexOf('. '),
      candidate.lastIndexOf('! '),
      candidate.lastIndexOf('? '),
    ]
    splitAt = Math.max(...sentenceSplits)
  }
  if (!isHealthyBoundary(splitAt)) {
    splitAt = candidate.lastIndexOf(' ')
  }
  return splitAt > 0 ? splitAt : candidate.length
}

/**
 * Split plain text for TTS into chunks at natural boundaries.
 * Priority: paragraph (\n\n) → sentence (. ! ?) → word (space) → hard cut.
 */
export function chunkTextForTTS(text, maxSize = TTS_CHUNK_SIZE) {
  const chunks = []
  const normalized = typeof text === 'string' ? text.trim() : ''
  if (!normalized) return []
  if (getByteLength(normalized) <= maxSize) {
    return [normalized]
  }

  let remaining = normalized

  while (remaining && getByteLength(remaining) > maxSize) {
    let end = 1
    while (end <= remaining.length && getByteLength(remaining.slice(0, end)) <= maxSize) {
      end += 1
    }
    end = Math.max(1, end - 1)
    const candidate = remaining.slice(0, end)
    const splitAt = findPreferredSplitAt(candidate, maxSize)
    const nextChunk = candidate.slice(0, splitAt).trim()

    if (nextChunk) {
      chunks.push(nextChunk)
    }
    const consumed = splitAt > 0 ? splitAt : candidate.length
    remaining = remaining.slice(consumed).trim()
  }

  if (remaining) {
    chunks.push(remaining)
  }

  // Final safety net: ensure every chunk is within byte limit.
  const safeChunks = []
  for (const chunk of chunks) {
    if (getByteLength(chunk) <= maxSize) {
      safeChunks.push(chunk)
      continue
    }
    safeChunks.push(...splitChunkByByteLength(chunk, maxSize))
  }

  return safeChunks
}
