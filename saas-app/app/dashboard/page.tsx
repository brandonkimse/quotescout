'use client';

import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useRouter } from 'next/navigation';

type Profile = {
  email: string;
  usage_count: number;
  is_subscribed: boolean;
};

type HistoryItem = {
  id: string;
  input_type: string;
  book_title: string | null;
  author: string | null;
  created_at: string;
};

export default function Dashboard() {
  const [user, setUser]         = useState<any>(null);
  const [profile, setProfile]   = useState<Profile | null>(null);
  const [history, setHistory]   = useState<HistoryItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [generating, setGenerating] = useState(false);
  const [upgrading, setUpgrading]   = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // form state
  const [inputType, setInputType] = useState<'book_title' | 'text_snippet'>('book_title');
  const [bookTitle, setBookTitle] = useState('');
  const [author, setAuthor]       = useState('');
  const [snippet, setSnippet]     = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const router = useRouter();
  const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL!;

  // ── helpers ──────────────────────────────────────────────────────────────

  async function getToken(): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? '';
  }

  async function fetchProfile(token: string) {
    const res = await fetch(`${BACKEND}/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setProfile(await res.json());
  }

  async function fetchHistory(token: string) {
    const res = await fetch(`${BACKEND}/history`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setHistory(await res.json());
  }

  // ── init ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) { router.push('/'); return; }
      setUser(user);

      const token = await getToken();
      await Promise.all([fetchProfile(token), fetchHistory(token)]);
      setLoading(false);

      // Check Stripe redirect params
      const params = new URLSearchParams(window.location.search);
      if (params.get('success') === 'true') {
        setShowSuccess(true);
        await fetchProfile(token);   // refresh subscription status
        window.history.replaceState({}, '', '/dashboard');
      }
    })();
  }, [router]);

  // ── generate ─────────────────────────────────────────────────────────────

  async function handleGenerate() {
    if (inputType === 'book_title' && !bookTitle.trim()) {
      alert('Please enter a book title.'); return;
    }
    if (inputType === 'text_snippet' && !snippet.trim()) {
      alert('Please paste or upload a text snippet.'); return;
    }

    setGenerating(true);
    try {
      const token = await getToken();
      const res = await fetch(`${BACKEND}/generate-quotes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          input_type: inputType,
          book_title: bookTitle,
          author,
          text_snippet: snippet,
        }),
      });

      if (res.status === 402) {
        alert('Free tier limit reached. Click "Upgrade to Pro" to continue.');
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
        alert(`Error: ${err.detail}`); return;
      }

      // trigger PDF download
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `quotes-${(bookTitle || 'analysis').replace(/\s+/g, '-').toLowerCase()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // refresh profile (usage_count) and history
      const t = await getToken();
      await Promise.all([fetchProfile(t), fetchHistory(t)]);
    } catch {
      alert('Something went wrong. Please try again.');
    } finally {
      setGenerating(false);
    }
  }

  // ── file upload ───────────────────────────────────────────────────────────

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setSnippet(ev.target?.result as string);
    reader.readAsText(file);
  }

  // ── upgrade ───────────────────────────────────────────────────────────────

  async function handleUpgrade() {
    setUpgrading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${BACKEND}/create-checkout-session`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else alert('Checkout failed. Please try again.');
    } catch {
      alert('Something went wrong.');
    } finally {
      setUpgrading(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/');
  }

  // ── derived ───────────────────────────────────────────────────────────────

  const usageCount = profile?.usage_count ?? 0;
  const canGenerate = profile?.is_subscribed || usageCount < 1;

  // ── render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Loading your dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-indigo-600">QuoteScout</span>
            {profile?.is_subscribed && (
              <span className="px-2 py-0.5 text-xs font-semibold bg-indigo-100 text-indigo-700 rounded-full">
                PRO
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500 hidden sm:block">{user?.email}</span>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* ── Banners ─────────────────────────────────────────────────── */}
        {showSuccess && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm font-medium flex justify-between">
            <span>You&apos;ve upgraded to Pro! Enjoy unlimited generations.</span>
            <button onClick={() => setShowSuccess(false)} className="opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {!profile?.is_subscribed && (
          <div className={`px-4 py-3 rounded-lg text-sm border ${
            usageCount === 0
              ? 'bg-blue-50 border-blue-200 text-blue-700'
              : 'bg-amber-50 border-amber-200 text-amber-700'
          }`}>
            {usageCount === 0
              ? '✨ You have 1 free generation — try QuoteScout now!'
              : '🔒 Free generation used. Upgrade to Pro for unlimited access.'}
          </div>
        )}

        {/* ── Generate card ────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-5">Generate Quote Analysis</h2>

          {/* input type toggle */}
          <div className="flex bg-gray-100 rounded-lg p-1 w-fit mb-5">
            {(['book_title', 'text_snippet'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setInputType(type)}
                className={`px-4 py-2 text-sm font-medium rounded-md transition ${
                  inputType === type
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {type === 'book_title' ? 'By Book Title' : 'Text Snippet'}
              </button>
            ))}
          </div>

          {/* inputs */}
          {inputType === 'book_title' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Book Title <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={bookTitle}
                  onChange={(e) => setBookTitle(e.target.value)}
                  placeholder="e.g. The Great Gatsby"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Author <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="e.g. F. Scott Fitzgerald"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Paste Text <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={snippet}
                  onChange={(e) => setSnippet(e.target.value)}
                  placeholder="Paste a passage from your book here…"
                  rows={7}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <span>or</span>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="text-indigo-600 hover:text-indigo-700 font-medium underline"
                >
                  Upload a .txt file
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt"
                  onChange={handleFile}
                  className="hidden"
                />
                {snippet && (
                  <span className="text-gray-400 ml-2">
                    ({snippet.length.toLocaleString()} chars)
                  </span>
                )}
              </div>
            </div>
          )}

          {/* action button */}
          <div className="mt-5">
            {canGenerate ? (
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {generating ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Generating PDF…
                  </>
                ) : 'Generate Quotes PDF'}
              </button>
            ) : (
              <button
                onClick={handleUpgrade}
                disabled={upgrading}
                className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg font-semibold hover:from-amber-600 hover:to-orange-600 transition disabled:opacity-60 flex items-center gap-2"
              >
                {upgrading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Redirecting…
                  </>
                ) : 'Upgrade to Pro — $9.99/mo'}
              </button>
            )}
          </div>
        </div>

        {/* ── History card ─────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Generation History</h2>

          {history.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">
              No generations yet. Generate your first quote analysis above!
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {history.map((item) => (
                <div key={item.id} className="py-3 flex justify-between items-start">
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {item.book_title || 'Text Snippet'}
                      {item.author && (
                        <span className="text-gray-500 font-normal"> — {item.author}</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {item.input_type === 'book_title' ? 'Book title' : 'Text snippet'} &bull;{' '}
                      {new Date(item.created_at).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })}
                    </p>
                  </div>
                  <span className="text-xs text-indigo-500 bg-indigo-50 px-2 py-1 rounded-full font-medium shrink-0 ml-4">
                    PDF
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

      </main>
    </div>
  );
}
