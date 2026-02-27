'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useRouter } from 'next/navigation';

export default function AuthPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // 1. Check if user is already logged in
  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      setLoading(false);
    };
    checkUser();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) alert(error.message);
      else alert('Success! Check your email for a confirmation link.');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) alert(error.message);
      else router.push('/dashboard');
    }
    setLoading(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    router.refresh();
  };

  if (loading) return <div className="flex justify-center mt-20">Loading...</div>;

  // 2. Reflect Login Status
  if (user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
        <div className="p-8 bg-white shadow-md rounded-lg text-center">
          <h1 className="text-2xl font-bold mb-2">Welcome Back!</h1>
          <p className="text-gray-600 mb-6 font-mono text-sm">{user.email}</p>
          <div className="flex gap-4">
            <button onClick={() => router.push('/dashboard')} className="px-6 py-2 bg-blue-600 text-white rounded font-bold">Go to Dashboard</button>
            <button onClick={handleLogout} className="px-6 py-2 border border-gray-300 rounded font-bold">Logout</button>
          </div>
        </div>
      </div>
    );
  }

  // 3. Login/Signup Form
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
      <form onSubmit={handleSubmit} className="p-8 bg-white shadow-md rounded-lg w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-6 text-center">{isSignUp ? 'Create Account' : 'Login'}</h1>
        
        <input
          type="email" placeholder="Email" className="w-full p-2 mb-4 border rounded"
          value={email} onChange={(e) => setEmail(e.target.value)} required
        />
        <input
          type="password" placeholder="Password" className="w-full p-2 mb-6 border rounded"
          value={password} onChange={(e) => setPassword(e.target.value)} required
        />

        <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded font-bold hover:bg-blue-700">
          {isSignUp ? 'Sign Up' : 'Login'}
        </button>

        <p className="mt-4 text-center text-sm">
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button type="button" onClick={() => setIsSignUp(!isSignUp)} className="text-blue-600 underline font-medium">
            {isSignUp ? 'Login here' : 'Sign up here'}
          </button>
        </p>
      </form>
    </div>
  );
}