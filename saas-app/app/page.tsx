'use client' // Necessary for useEffect/useState
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

export default function LandingPage() {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    // Check if a user is already logged in when the page loads
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    };
    getUser();
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <h1 className="text-5xl font-bold text-gray-900 mb-4 text-center">
        <span className="text-indigo-600">QuoteScout</span>
      </h1>
      <p className="text-xl text-gray-600 mb-3 text-center max-w-md">
        AI-powered literary quote analysis for English class.
      </p>
      <p className="text-sm text-gray-400 mb-10 text-center max-w-sm">
        Enter a book title or paste a passage — get a formatted PDF of the most important quotes with literary analysis.
      </p>

      <div className="flex gap-4">
        {user ? (
          // If logged in, show Dashboard
          <Link href="/dashboard">
            <button className="px-8 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition">
              Resume to Dashboard
            </button>
          </Link>
        ) : (
          // If NOT logged in, show Login
          <Link href="/login">
            <button className="px-8 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition">
              Login / Sign Up
            </button>
          </Link>
        )}
      </div>
    </div>
  );
}