import { useEffect, useState } from 'react';
import { Layout, PageHeader } from '../components/Layout';
import { useAuth } from '../lib/auth';
import { useRouter } from '../lib/router';
import { useToast } from '../lib/toast';
import { supabase, fmt, wrapPassword } from '../lib/supabase';
import { Loader2, Gift, Key, ShoppingBag, CheckCircle2, XCircle } from 'lucide-react';

export function RedeemPage() {
  const { profile, refreshProfile } = useAuth();
  const { navigate } = useRouter();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!profile) navigate('/login', { replace: true });
  }, [profile, navigate]);

  if (!profile) return null;

  const redeem = async () => {
    if (!code.trim()) { toast.error('Enter a code'); return; }
    setSubmitting(true);

    const { data: found } = await supabase
      .from('redeem_codes')
      .select('*')
      .eq('code', code.trim().toUpperCase())
      .maybeSingle();

    if (!found) { setSubmitting(false); toast.error('Invalid code'); return; }
    if (!found.is_active) { setSubmitting(false); toast.error('Code is inactive'); return; }
    if (found.used_count >= found.max_uses) { setSubmitting(false); toast.error('Code fully redeemed'); return; }

    if (found.expires_at && new Date(found.expires_at) < new Date()) {
      setSubmitting(false); toast.error('Code expired'); return;
    }

    const { data: existing } = await supabase
      .from('user_redeems')
      .select('id')
      .eq('user_id', profile.id)
      .eq('code_id', found.id)
      .maybeSingle();

    if (existing) {
      setSubmitting(false);
      toast.error('You have already redeemed this code');
      return;
    }

    if (found.expiry_minutes) {
      const { data: firstRedeem } = await supabase
        .from('user_redeems')
        .select('created_at')
        .eq('code_id', found.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (firstRedeem) {
        const elapsed = (Date.now() - new Date(firstRedeem.created_at).getTime()) / 60000;
        if (elapsed > found.expiry_minutes) {
          setSubmitting(false); toast.error('Code has expired');
          return;
        }
      }
    }

    const { error: insErr } = await supabase.from('user_redeems').insert({
      user_id: profile.id,
      code_id: found.id,
      code: found.code,
      reward_amount: found.reward_amount,
    });

    if (insErr) {
      setSubmitting(false);
      if (insErr.code === '23505') {
        toast.error('You have already redeemed this code');
      } else {
        toast.error(insErr.message);
      }
      return;
    }

    await supabase.from('redeem_codes').update({ used_count: found.used_count + 1 }).eq('id', found.id);
    await supabase.from('transactions').insert({
      user_id: profile.id,
      type: 'redeem',
      amount: found.reward_amount,
      description: `Redeemed code ${found.code}`,
    });
    await supabase.from('profiles').update({
      main_balance: (profile.main_balance || 0) + found.reward_amount,
      total_earnings: (profile.total_earnings || 0) + found.reward_amount,
    }).eq('id', profile.id);

    await refreshProfile();
    setSubmitting(false);
    setCode('');
    toast.success(`Redeemed! +RWF ${fmt(found.reward_amount)}`);
  };

  return (
    <Layout>
      <PageHeader title="Redeem Gift" />
      <div className="p-4 space-y-4">
        <div className="bg-white rounded-2xl p-6 text-center border border-border shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-primary/5 -translate-y-12 translate-x-12" />
          <div className="relative">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <Gift className="w-7 h-7 text-primary" />
            </div>
            <div className="text-sm font-bold text-foreground">Enter your gift code</div>
            <div className="text-xs text-muted-foreground mt-1">Each code can only be redeemed once per user</div>
          </div>
        </div>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Enter code"
          className="input-field text-center text-lg font-mono font-bold uppercase tracking-wider"
        />
        <button
          onClick={redeem}
          disabled={submitting}
          className="w-full btn-primary py-3.5 text-sm flex items-center justify-center gap-2"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {submitting ? 'Redeeming...' : 'Redeem'}
        </button>
      </div>
    </Layout>
  );
}

export function ChangePasswordPage() {
  const { navigate } = useRouter();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!current || !next || !confirm) { toast.error('Fill all fields'); return; }
    if (next !== confirm) { toast.error('Passwords do not match'); return; }
    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) { setSubmitting(false); toast.error('Session expired'); return; }
    let verified = false;
    for (const pw of [wrapPassword(current), current]) {
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email: user.email, password: pw });
      if (!signInErr) { verified = true; break; }
      if (!/invalid login credentials/i.test(signInErr.message)) break;
    }
    if (!verified) { setSubmitting(false); toast.error('Current password is incorrect'); return; }
    const { error } = await supabase.auth.updateUser({ password: wrapPassword(next) });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Password updated');
    navigate('/profile');
  };

  return (
    <Layout>
      <PageHeader title="Change Password" />
      <div className="p-4 space-y-4">
        <div className="bg-white rounded-2xl p-6 text-center border border-border shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-primary/5 -translate-y-12 translate-x-12" />
          <div className="relative">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <Key className="w-7 h-7 text-primary" />
            </div>
            <div className="text-sm font-bold text-foreground">Update your password</div>
            <div className="text-xs text-muted-foreground mt-1">Enter your current password to make changes</div>
          </div>
        </div>
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" className="input-field" />
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password" className="input-field" />
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new password" className="input-field" />
        <button
          onClick={submit}
          disabled={submitting}
          className="w-full btn-primary py-3.5 text-sm flex items-center justify-center gap-2"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {submitting ? 'Updating...' : 'Update Password'}
        </button>
      </div>
    </Layout>
  );
}

export function MyProductsPage() {
  const { profile } = useAuth();
  const { navigate } = useRouter();
  const [vips, setVips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    supabase.from('user_vips').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }).then(({ data }) => {
      setVips(data || []);
      setLoading(false);
    });
  }, [profile]);

  useEffect(() => {
    if (!profile) navigate('/login', { replace: true });
  }, [profile, navigate]);

  if (!profile) return null;

  const active = vips.filter((v: any) => v.is_active);
  const totalIncome = vips.reduce((s, v) => s + (v.days_paid || 0) * v.daily_income, 0);

  return (
    <Layout>
      <PageHeader title="My Products" />
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-2xl p-4 border border-border shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 rounded-full bg-primary/5 -translate-y-10 translate-x-10" />
            <div className="relative">
              <div className="text-xs text-muted-foreground">Active Plans</div>
              <div className="text-2xl font-black text-foreground">{active.length}</div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 border border-border shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 rounded-full bg-amber-500/5 -translate-y-10 translate-x-10" />
            <div className="relative">
              <div className="text-xs text-muted-foreground">Total Income</div>
              <div className="text-xl font-black text-foreground">RWF {fmt(totalIncome)}</div>
            </div>
          </div>
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : vips.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-border">
            <ShoppingBag className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <div className="text-sm text-muted-foreground font-medium">No products yet</div>
            <button onClick={() => navigate('/vip')} className="mt-3 btn-gold rounded-xl px-6 py-2.5 text-sm font-bold">
              Browse VIP Plans
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {vips.map((v) => (
              <div key={v.id} className="bg-white rounded-2xl p-4 border border-border shadow-sm premium-card">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-bold text-foreground">{v.plan_name}</div>
                  {v.is_active ? (
                    <span className="status-badge bg-emerald-50 text-emerald-700 border border-emerald-200"><CheckCircle2 className="w-3 h-3" />Active</span>
                  ) : (
                    <span className="status-badge bg-muted text-muted-foreground border border-border"><XCircle className="w-3 h-3" />Expired</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-muted/40 rounded-xl p-2.5">
                    <div className="text-muted-foreground">Investment</div>
                    <div className="font-bold text-foreground mt-0.5">RWF {fmt(v.investment_amount)}</div>
                  </div>
                  <div className="bg-muted/40 rounded-xl p-2.5">
                    <div className="text-muted-foreground">Daily</div>
                    <div className="font-bold text-foreground mt-0.5">RWF {fmt(v.daily_income)}</div>
                  </div>
                  <div className="bg-muted/40 rounded-xl p-2.5">
                    <div className="text-muted-foreground">Days paid</div>
                    <div className="font-bold text-foreground mt-0.5">{v.days_paid}/{v.duration_days}</div>
                  </div>
                  <div className="bg-muted/40 rounded-xl p-2.5">
                    <div className="text-muted-foreground">Total return</div>
                    <div className="font-bold text-foreground mt-0.5">RWF {fmt(v.total_return)}</div>
                  </div>
                </div>
                {/* Progress bar */}
                <div className="mt-3">
                  <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                    <span>Progress</span>
                    <span>{Math.round((v.days_paid / v.duration_days) * 100)}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-green transition-all duration-500"
                      style={{ width: `${Math.min((v.days_paid / v.duration_days) * 100, 100)}%` }}
                    />
                  </div>
                </div>
                {v.is_active && (
                  <button
                    onClick={() => navigate('/tasks')}
                    className="w-full mt-3 btn-primary rounded-xl py-2.5 text-xs font-bold"
                  >
                    Complete daily reviews
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
