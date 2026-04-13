'use client'

import { useState } from 'react'
import Link from 'next/link'
import Nav from '@/components/Nav'
import { isValidCashAddress } from 'ecashaddrjs'
import { supabase } from '@/lib/supabase-browser'

function isValidXecAddress(address) {
  try {
    return isValidCashAddress(address.trim(), 'ecash')
  } catch {
    return false
  }
}

const XEC_ADDRESS_INVALID_MESSAGE =
  'Please enter a valid eCash (XEC) wallet address. It should start with ecash:q...'
const XEC_WALLET_ADDRESS_HELPER = 'Your address should start with ecash:q'

const SIGNUP_SUCCESS_MESSAGE =
  "Account created! Please check your email and click the confirmation link to activate your account. Don't forget to check your spam folder."

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [bio, setBio] = useState('')
  const [xecAddress, setXecAddress] = useState('')
  const [xecAddressInfoOpen, setXecAddressInfoOpen] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    if (!isValidXecAddress(xecAddress)) {
      setError(XEC_ADDRESS_INVALID_MESSAGE)
      return
    }

    setLoading(true)

    try {
      const { error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            username: username.trim(),
            xec_address: xecAddress.trim(),
          },
        },
      })

      if (authError) {
        setError(authError.message)
        return
      }

      setEmail('')
      setPassword('')
      setUsername('')
      setBio('')
      setXecAddress('')
      setSuccess(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <Nav />
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Author signup
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Create an account to publish and earn XEC.
        </p>

        <form method="post" onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:border-zinc-400 focus:ring-2 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-500"
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-500"
              />
            </div>
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Username
              </label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="nickname"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-500"
              />
            </div>
            <div>
              <label
                htmlFor="bio"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Bio <span className="font-normal text-zinc-500">(optional)</span>
              </label>
              <textarea
                id="bio"
                name="bio"
                rows={4}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="mt-1 w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-500"
                placeholder="A short introduction for your public author page"
              />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="xec_address"
                  className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
                >
                  XEC wallet address
                </label>
                <div
                  className="relative inline-flex flex-col items-start"
                  onMouseLeave={() => setXecAddressInfoOpen(false)}
                >
                  <button
                    type="button"
                    id="xec-wallet-address-info"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-emerald-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-emerald-400 dark:focus-visible:ring-offset-zinc-950"
                    aria-label="What is an XEC wallet address?"
                    aria-expanded={xecAddressInfoOpen}
                    aria-controls="xec-wallet-address-tooltip"
                    onMouseEnter={() => setXecAddressInfoOpen(true)}
                    onClick={() => setXecAddressInfoOpen((o) => !o)}
                  >
                    <span aria-hidden className="select-none text-sm leading-none">
                      ⓘ
                    </span>
                  </button>
                  {xecAddressInfoOpen ? (
                    <div
                      id="xec-wallet-address-tooltip"
                      role="tooltip"
                      className="absolute top-full left-0 z-20 mt-1 w-[min(calc(100vw-4rem),20rem)] rounded-lg border border-zinc-200 bg-white p-3 text-left text-xs leading-relaxed text-zinc-700 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                      onMouseEnter={() => setXecAddressInfoOpen(true)}
                    >
                      <p>
                        This is your eCash (XEC) receive address— the place readers send payment
                        when they unlock your articles.
                      </p>
                      <p className="mt-2">
                        It should look like ecash:q… (starts with ecash:q).
                      </p>
                      <p className="mt-2">
                        Don&apos;t have a wallet yet?{' '}
                        <a
                          href="https://cashtab.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
                        >
                          Click here
                        </a>
                        . Don&apos;t forget to backup your wallet!
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
              <input
                id="xec_address"
                name="xec_address"
                type="text"
                autoComplete="off"
                required
                value={xecAddress}
                onChange={(e) => setXecAddress(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-500"
              />
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                {XEC_WALLET_ADDRESS_HELPER}
              </p>
            </div>

            {error ? (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              {loading ? 'Creating account…' : 'Sign up'}
            </button>

            {success ? (
              <div
                className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/40"
                role="status"
              >
                <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">
                  {SIGNUP_SUCCESS_MESSAGE}
                </p>
              </div>
            ) : null}
          </form>

        <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
          <Link href="/login" className="font-medium text-zinc-900 underline dark:text-zinc-200">
            Author login
          </Link>
          {' · '}
          <Link href="/" className="font-medium text-zinc-900 underline dark:text-zinc-200">
            Back to home
          </Link>
        </p>
      </div>
      </div>
    </div>
  )
}
