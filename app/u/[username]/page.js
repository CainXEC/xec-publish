import { notFound } from 'next/navigation'
import Nav from '@/components/Nav'
import AuthorProfilePosts from '@/components/AuthorProfilePosts'
import CopyableAddress from '@/components/CopyableAddress'
import { loadAuthorProfileByUsername } from '@/lib/loadAuthorProfile'

export default async function AuthorProfilePage({ params }) {
  const { username: raw } = await params
  if (typeof raw !== 'string' || !raw.trim()) {
    notFound()
  }

  const username = decodeURIComponent(raw.trim())

  const { error, author, posts: postList } =
    await loadAuthorProfileByUsername(username)

  if (!author) {
    notFound()
  }

  const postsErrorMessage = error || null
  const bioText =
    author.bio != null && String(author.bio).trim() !== ''
      ? String(author.bio).trim()
      : ''

  return (
    <div className="min-h-full flex-1 bg-zinc-50 dark:bg-zinc-950">
      <Nav />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="border-b border-zinc-200 pb-10 dark:border-zinc-800">
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Author
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-5xl">
            @{author.username}
          </h1>
          {author.xec_address ? <CopyableAddress address={author.xec_address} /> : null}
          {bioText ? (
            <p className="mt-6 max-w-2xl whitespace-pre-wrap text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
              {bioText}
            </p>
          ) : null}
        </header>

        <AuthorProfilePosts
          initialPosts={postList}
          postsErrorMessage={postsErrorMessage}
        />
      </main>
    </div>
  )
}
