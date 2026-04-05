'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const DELETE_CONFIRM =
  'Are you sure you want to delete this post? This cannot be undone.'

export default function DashboardPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [email, setEmail] = useState('')
  const [posts, setPosts] = useState([])
  const [deleteError, setDeleteError] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => {
    let isMounted = true

    async function loadDashboard() {
      setLoading(true)
      setError(null)

      const { data: userData, error: userError } = await supabase.auth.getUser()

      if (userError) {
        if (isMounted) {
          setError(userError.message)
          setLoading(false)
        }
        return
      }

      const user = userData.user
      if (!user) {
        router.replace('/login')
        return
      }

      const { data: postsData, error: postsError } = await supabase
        .from('posts')
        .select('*')
        .eq('author_id', user.id)
        .order('created_at', { ascending: false })

      if (postsError) {
        if (isMounted) {
          setError(postsError.message)
          setLoading(false)
        }
        return
      }

      if (isMounted) {
        setEmail(user.email ?? '')
        setPosts(postsData ?? [])
        setLoading(false)
      }
    }

    loadDashboard()

    return () => {
      isMounted = false
    }
  }, [router])

  const handleDeletePost = useCallback(async (postId) => {
    if (!window.confirm(DELETE_CONFIRM)) return

    setDeleteError(null)
    setDeletingId(postId)

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError || !userData.user) {
        setDeleteError(userError?.message || 'You must be signed in to delete a post.')
        return
      }

      const userId = userData.user.id

      const { error: deleteErrorResult, count } = await supabase
        .from('posts')
        .delete({ count: 'exact' })
        .eq('id', postId)
        .eq('author_id', userId)

      if (deleteErrorResult) {
        setDeleteError(deleteErrorResult.message)
        return
      }

      if (typeof count === 'number' && count === 0) {
        setDeleteError('Could not delete this post. It may have already been removed.')
        return
      }

      setPosts((prev) => prev.filter((p) => p.id !== postId))
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Something went wrong while deleting.',
      )
    } finally {
      setDeletingId(null)
    }
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-zinc-950">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading dashboard...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-zinc-950">
        <div className="w-full max-w-xl rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <Link href="/login" className="mt-4 inline-block text-sm font-medium text-zinc-900 underline dark:text-zinc-200">
            Go to login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 px-4 py-10 dark:bg-zinc-950">
      <main className="mx-auto w-full max-w-4xl">
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Author Dashboard</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Welcome, {email}</p>

          <Link
            href="/dashboard/new-post"
            className="mt-5 inline-flex rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            Write New Post
          </Link>
        </div>

        <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Your Posts</h2>

          {deleteError ? (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-200" role="alert">
              {deleteError}
            </p>
          ) : null}

          {posts.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
              You have not created any posts yet.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {posts.map((post) => (
                <li
                  key={post.id}
                  className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-950"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      {post.slug ? (
                        <Link
                          href={`/posts/${encodeURIComponent(post.slug)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block text-base font-medium text-emerald-700 underline-offset-2 hover:text-emerald-600 hover:underline dark:text-emerald-400 dark:hover:text-emerald-300"
                        >
                          {post.title ?? 'Untitled post'}
                        </Link>
                      ) : (
                        <p className="text-base font-medium text-zinc-900 dark:text-zinc-50">
                          {post.title ?? 'Untitled post'}
                        </p>
                      )}
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                        Status: {post.published ? 'Published' : 'Draft'}
                      </p>
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                        Price: {post.price_xec ?? 0} XEC
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeletePost(post.id)}
                      disabled={deletingId !== null}
                      className="shrink-0 rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300 dark:hover:bg-red-950"
                    >
                      {deletingId === post.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}

