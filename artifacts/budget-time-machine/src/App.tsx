import { type ChangeEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Archive, ArrowDown, ArrowUpRight, Bot, CalendarDays, Check, ChevronRight, CircleHelp, Clock3, Download, FileClock, Film, GitCompare, History, Inbox, Loader2, Menu, Plus, RefreshCw, Scissors, Send, Settings2, ShieldCheck, Sparkles, Trash2, Upload, X, Zap } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  useApplyChange, useGetAdvisorRecommendations, useGetDecisionLog, useGetProductionGraph,
  useHealthCheck, useIngestProductionText, useListScenarios, useLoadSampleProduction,
  useLoadScenario, useDeleteScenario, useSaveScenario, useSimulateChange, useCompareScenarios,
  getGetProductionGraphQueryKey, getGetDecisionLogQueryKey, getListScenariosQueryKey,
} from '@workspace/api-client-react';
import { setProductionRoom } from '@workspace/api-client-react';
import type { ApplyResult, IngestInput, ProductionGraph, SimulationResult } from '@workspace/api-client-react';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();
const money = (value: number | null | undefined, currency = 'USD') =>
  value == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
const dateLabel = (value: string | null | undefined) => value ? new Date(value + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Date TBD';
const errorText = (error: unknown) => (error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : 'Something interrupted the control room. Try again.');

function Button({ children, variant = 'dark', className = '', ...props }: { children: ReactNode; variant?: 'dark' | 'lime' | 'ghost' | 'coral'; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const colors = { dark: 'bg-[#243047] text-[#f4f0e7] hover:bg-[#31415e]', lime: 'bg-[#d8e86a] text-[#243047] hover:bg-[#e4f28a]', ghost: 'bg-transparent text-[#536078] hover:bg-[#e5e1d7]', coral: 'bg-[#e56c4f] text-white hover:bg-[#ee8066]' };
  return <button {...props} className={`inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-[12px] font-bold tracking-[.02em] transition-all duration-200 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 ${colors[variant]} ${className}`}>{children}</button>;
}
function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'danger' }) {
  const tones = { neutral: 'bg-[#e7e3d9] text-[#536078]', good: 'bg-[#d3ebe5] text-[#17605b]', warn: 'bg-[#f1edb9] text-[#625d16]', danger: 'bg-[#f4d2c9] text-[#a33d2f]' };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 font-mono text-[10px] uppercase tracking-[.09em] ${tones[tone]}`}>{children}</span>;
}
function Overlay({ title, eyebrow, children, onClose, wide = false }: { title: string; eyebrow: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="fixed inset-0 z-40 flex items-end justify-end bg-[#182033]/45 backdrop-blur-[2px]" role="dialog" aria-modal="true">
    <div className={`reveal grid-paper h-[min(92vh,820px)] w-full overflow-y-auto border-l border-[#3c4961] bg-[#f4f0e7] p-5 shadow-2xl sm:p-8 ${wide ? 'max-w-3xl' : 'max-w-xl'}`}>
      <div className="mb-7 flex items-start justify-between gap-6"><div><div className="mb-2 font-mono text-[10px] uppercase tracking-[.18em] text-[#e56c4f]">{eyebrow}</div><h2 className="font-display text-3xl font-bold tracking-[-.04em] text-[#243047]">{title}</h2></div><button data-testid="button-close-overlay" onClick={onClose} className="rounded-full p-2 text-[#536078] transition hover:bg-[#e5e1d7]"><X size={18} /></button></div>
      {children}
    </div>
  </div>;
}
function Skeleton() { return <div className="space-y-3"><div className="shimmer h-7 w-2/5 rounded" /><div className="shimmer h-16 rounded" /><div className="shimmer h-16 rounded" /></div>; }

type ProducerUser = { userId: string; email: string; displayName: string };
type RoomSummary = { roomId: string; name: string; role: string; visibility: string; anonymous?: boolean; hasProduction?: boolean };
type RoomContext = { room: RoomSummary; user: ProducerUser | null };

async function appApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
  return body as T;
}

function AppShell() {
  const qc = useQueryClient();
  const [user, setUser] = useState<ProducerUser | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [activeRoomId, setActiveRoomId] = useState(() => window.localStorage.getItem('the_line_active_room'));
  const [authOpen, setAuthOpen] = useState(false);
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [authError, setAuthError] = useState('');
  const [contextLoading, setContextLoading] = useState(true);
  const roomKey = activeRoomId ?? 'anonymous';
  useEffect(() => { setProductionRoom(activeRoomId); }, [activeRoomId]);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      appApi<{ user: ProducerUser | null }>('/api/auth/me'),
      appApi<RoomContext>('/api/room-context'),
    ]).then(([auth, context]) => {
      if (cancelled) return;
      setUser(auth.user);
      setActiveRoomId((current) => {
        const next = current ?? context.room.roomId;
        window.localStorage.setItem('the_line_active_room', next);
        return next;
      });
      setContextLoading(false);
    }).catch((error) => { if (!cancelled) { setAuthError(errorText(error)); setContextLoading(false); } });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!user) { setRooms([]); return; }
    appApi<{ rooms: RoomSummary[] }>('/api/rooms').then(({ rooms: nextRooms }) => {
      setRooms(nextRooms);
      setActiveRoomId((current) => {
        const next = current ?? nextRooms[0]?.roomId;
        if (next) window.localStorage.setItem('the_line_active_room', next);
        return next;
      });
    }).catch((error) => setAuthError(errorText(error)));
  }, [user]);
  const graphQuery = useGetProductionGraph({ query: { queryKey: [...getGetProductionGraphQueryKey(), roomKey], retry: false, enabled: !contextLoading } });
  const health = useHealthCheck();
  const sample = useLoadSampleProduction({ query: { enabled: false, queryKey: ['/api/sample'] } });
  const ingest = useIngestProductionText();
  const simulate = useSimulateChange();
  const apply = useApplyChange();
  const graph = graphQuery.data;
  const [overlay, setOverlay] = useState<'ingest' | 'simulate' | 'apply' | 'advisor' | 'scenarios' | 'log' | 'export' | 'applied' | null>(null);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [appliedPlan, setAppliedPlan] = useState<ApplyResult | null>(null);
  const [advisorPreset, setAdvisorPreset] = useState<{ dayId: string; changeType: string }>();
  const [toast, setToast] = useState('');
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 3500); };
  const refresh = () => qc.invalidateQueries({ queryKey: [...getGetProductionGraphQueryKey(), roomKey] });
  const onSample = () => sample.refetch().then((result) => { if (result.data) { setSimulation(null); setAppliedPlan(null); setAdvisorPreset(undefined); refresh(); notify('Demo production reset to a clean active room.'); } });
  const onIngest = (input: IngestInput) => ingest.mutate({ data: input }, { onSuccess: () => { refresh(); setOverlay(null); notify('Production documents parsed. Review the new graph.'); } });
  const onSimulate = (dayId: string, changeType: string, details: Record<string, string>) => simulate.mutate({ data: { dayId, changeType: changeType as never, details } }, { onSuccess: (result) => { setSimulation(result); setOverlay('apply'); }, onError: (e) => notify(errorText(e)) });
  const onApply = () => simulation && apply.mutate({ data: { changeId: simulation.changeId, confirmed: true } }, { onSuccess: (result) => { qc.setQueryData([...getGetProductionGraphQueryKey(), roomKey], result.graph); qc.invalidateQueries({ queryKey: [...getGetDecisionLogQueryKey(), roomKey] }); setAppliedPlan(result); setSimulation(null); setOverlay('applied'); notify('Plan committed. Review the applied plan pack.'); }, onError: (e) => notify(errorText(e)) });
  const switchRoom = (roomId: string) => {
    setActiveRoomId(roomId);
    window.localStorage.setItem('the_line_active_room', roomId);
    setSimulation(null); setAppliedPlan(null); setAdvisorPreset(undefined); setOverlay(null);
    void qc.invalidateQueries();
  };
  const onAuth = async (mode: 'signin' | 'signup', input: { email: string; password: string; displayName?: string }) => {
    const result = await appApi<{ user: ProducerUser }>(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify(input) });
    setUser(result.user);
    setAuthOpen(false);
    setAuthError('');
    notify(mode === 'signin' ? 'Signed in. Your production rooms are ready.' : 'Account created. Your rooms are now portable across browsers.');
  };
  const signOut = async () => {
    await appApi<void>('/api/auth/signout', { method: 'POST' });
    setUser(null); setRooms([]); setAuthOpen(false); setAuthError('');
    setActiveRoomId(null); window.localStorage.removeItem('the_line_active_room');
    setProductionRoom(null);
    void qc.invalidateQueries();
  };
  const claimRoom = async () => {
    if (!activeRoomId || !user) return;
    try {
      await appApi(`/api/rooms/${activeRoomId}/claim`, { method: 'POST', body: JSON.stringify({}) });
      const next = await appApi<{ rooms: RoomSummary[] }>('/api/rooms');
      setRooms(next.rooms);
      notify('This private browser room is now owned by your team.');
    } catch (error) { notify(errorText(error)); }
  };
  const invite = async () => {
    if (!activeRoomId) return;
    const email = window.prompt('Collaborator email');
    if (!email) return;
    try {
      const result = await appApi<{ token: string }>(`/api/rooms/${activeRoomId}/invites`, { method: 'POST', body: JSON.stringify({ email, role: 'editor' }) });
      notify(`Invite created. Share this one-time code: ${result.token}`);
    } catch (error) { notify(errorText(error)); }
  };
  const acceptInvite = async () => {
    const token = window.prompt('Paste the collaborator invite code');
    if (!token) return;
    try {
      const result = await appApi<{ roomId: string }>(`/api/room-invites/${encodeURIComponent(token)}/accept`, { method: 'POST' });
      const next = await appApi<{ rooms: RoomSummary[] }>('/api/rooms');
      setRooms(next.rooms);
      switchRoom(result.roomId);
      notify('You joined the production room.');
    } catch (error) { notify(errorText(error)); }
  };
  const createRoom = async (name: string) => {
    const result = await appApi<{ room: RoomSummary }>('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    setRooms((current) => [result.room, ...current.filter((room) => room.roomId !== result.room.roomId)]);
    switchRoom(result.room.roomId);
    setCreateRoomOpen(false);
    notify(`Room created: ${result.room.name}`);
  };

  const graphError = graphQuery.isError && !errorText(graphQuery.error).includes('No production loaded') ? errorText(graphQuery.error) : '';
  return <div className="noise min-h-[100dvh] bg-[#f4f0e7] text-[#243047]">
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-[248px] flex-col justify-between bg-[#243047] px-5 py-6 text-[#f4f0e7] md:flex">
       <div><div className="mb-12 flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded bg-[#d8e86a] text-[#243047]"><Film size={18} strokeWidth={2.5} /></div><div><div className="font-display text-[15px] font-bold tracking-[-.03em]">the line</div><div className="font-mono text-[10px] uppercase tracking-[.18em] text-[#aab5c7]">budget time-machine</div></div></div>
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[.16em] text-[#7f8ba1]">Control room</div>
        <nav className="space-y-1"><NavItem icon={<CalendarDays size={16} />} label="Active production" active /><NavItem icon={<GitCompare size={16} />} label="Scenarios" onClick={() => setOverlay('scenarios')} /><NavItem icon={<History size={16} />} label="Decision log" onClick={() => setOverlay('log')} /></nav>
        <div className="my-8 h-px bg-[#3e4b64]" /><div className="mb-3 font-mono text-[10px] uppercase tracking-[.16em] text-[#7f8ba1]">Workspace</div>
        <nav className="space-y-1"><NavItem icon={<Inbox size={16} />} label="Ingest documents" onClick={() => setOverlay('ingest')} /><NavItem icon={<Archive size={16} />} label="Export pack" onClick={() => setOverlay('export')} /></nav>
       </div>
       <div className="mt-6 rounded-lg border border-[#3e4b64] bg-[#2d3a54] p-3">
          <div className="mb-2 flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-widest text-[#9ca9bd]">Team room</span>{user ? <div className="flex items-center gap-2"><button className="text-[10px] font-bold text-[#d8e86a]" onClick={() => setCreateRoomOpen(true)} aria-label="Create team room"><Plus size={14} /></button><button className="text-[10px] font-bold text-[#d8e86a]" onClick={() => void invite()} aria-label="Invite collaborator">Invite</button></div> : <button className="text-[#d8e86a]" onClick={() => setAuthOpen(true)} aria-label="Sign in"><ShieldCheck size={14} /></button>}</div>
         {user ? <><select value={activeRoomId ?? ''} onChange={(event) => switchRoom(event.target.value)} className="w-full rounded bg-[#243047] px-2 py-2 text-xs text-[#f4f0e7] outline-none"><option value="" disabled>Select a room</option>{rooms.map((room) => <option key={room.roomId} value={room.roomId}>{room.name} · {room.role}</option>)}</select><div className="mt-2 truncate text-[10px] text-[#c8d1dd]">{user.displayName} · {user.email}</div><button className="mt-2 text-[10px] font-bold text-[#d8e86a]" onClick={() => void acceptInvite()}>Join invite</button><button className="ml-3 mt-2 text-[10px] font-bold text-[#d8e86a]" onClick={() => void signOut()}>Sign out</button></> : <button className="text-left text-[11px] leading-relaxed text-[#c8d1dd]" onClick={() => setAuthOpen(true)}>Sign in to recover rooms across browsers and invite collaborators.</button>}
         {!user && activeRoomId && <button className="mt-2 text-[10px] font-bold text-[#d8e86a]" onClick={() => setAuthOpen(true)}>Claim this private room after signing in</button>}
         {user && activeRoomId && !rooms.some((room) => room.roomId === activeRoomId) && <button className="mt-2 text-[10px] font-bold text-[#d8e86a]" onClick={() => void claimRoom()}>Claim this private room</button>}
       </div>
        <div className="rounded-lg border border-[#3e4b64] bg-[#2d3a54] p-3"><div className="mb-2 flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-widest text-[#9ca9bd]">Agent relay</span><span className={`h-2 w-2 rounded-full ${health.isError ? 'bg-[#e56c4f]' : 'bg-[#d8e86a]'}`} /></div><p className="text-[11px] leading-relaxed text-[#c8d1dd]">{health.isLoading ? 'Checking the relay…' : health.isError ? 'Relay needs attention.' : 'Simulation agents are standing by.'}</p><div className="mt-2 border-t border-[#3e4b64] pt-2 font-mono text-[9px] uppercase tracking-widest text-[#9ca9bd]">{user ? 'Room synced to your team' : 'Private room in this browser'}</div></div>
    </aside>
    <main className="md:ml-[248px]">
       <header className="sticky top-0 z-10 flex min-h-[72px] items-center justify-between border-b border-[#d7d3ca] bg-[#f4f0e7]/92 px-4 backdrop-blur-md sm:px-8"><div className="flex items-center gap-3"><button className="rounded p-2 md:hidden" aria-label="Open navigation"><Menu size={19} /></button><div><div className="font-mono text-[10px] uppercase tracking-[.2em] text-[#e56c4f]">Production control / {user ? 'team' : 'private'}</div><div className="font-display mt-0.5 text-sm font-bold">{graph?.productionName ?? 'No production loaded'}</div></div></div><div className="flex items-center gap-2"><Button data-testid="button-auth" variant="ghost" onClick={() => user ? void signOut() : setAuthOpen(true)}>{user ? user.displayName : 'Sign in'}</Button><Button data-testid="button-ingest" variant="ghost" onClick={() => setOverlay('ingest')}><Upload size={14} /> <span className="hidden sm:inline">Ingest</span></Button><Button data-testid="button-advisor" variant="ghost" onClick={() => setOverlay('advisor')}><Sparkles size={14} /> <span className="hidden sm:inline">Advisor</span></Button><Button data-testid="button-simulate" variant="lime" onClick={() => setOverlay('simulate')}><Zap size={14} /> Simulate</Button></div></header>
      <div className="mx-auto max-w-[1440px] p-4 sm:p-8">
        {!graph && graphQuery.isLoading ? <Skeleton /> : !graph ? <EmptyProduction onSample={onSample} loading={sample.isFetching} onIngest={() => setOverlay('ingest')} error={graphError} /> : <Dashboard graph={graph} appliedPlan={appliedPlan} onViewApplied={() => setOverlay('applied')} onSimulate={() => { setAdvisorPreset(undefined); setOverlay('simulate'); }} onApply={() => simulation && setOverlay('apply')} onAdvisor={() => setOverlay('advisor')} />}
      </div>
    </main>
    {overlay === 'ingest' && <IngestModal loading={ingest.isPending} error={ingest.error ? errorText(ingest.error) : ''} onClose={() => setOverlay(null)} onSubmit={onIngest} />}
    {overlay === 'simulate' && graph && <SimulateModal graph={graph} preset={advisorPreset} loading={simulate.isPending} onClose={() => { setAdvisorPreset(undefined); setOverlay(null); }} onSubmit={onSimulate} />}
    {overlay === 'apply' && simulation && <ApplyModal simulation={simulation} loading={apply.isPending} onClose={() => setOverlay(null)} onApply={onApply} />}
     {overlay === 'advisor' && <AdvisorDrawer roomKey={roomKey} onClose={() => setOverlay(null)} onSimulate={(dayId, changeType) => { setAdvisorPreset({ dayId, changeType }); setOverlay('simulate'); }} />}
     {overlay === 'scenarios' && <ScenariosDrawer roomKey={roomKey} graph={graph} onClose={() => setOverlay(null)} notify={notify} />}
     {overlay === 'log' && <LogDrawer roomKey={roomKey} onClose={() => setOverlay(null)} />}
     {overlay === 'export' && graph && <ExportDrawer roomKey={roomKey} graph={graph} onClose={() => setOverlay(null)} notify={notify} />}
    {overlay === 'applied' && appliedPlan && <AppliedPlanDrawer result={appliedPlan} onClose={() => setOverlay(null)} />}
     {authOpen && <AuthDialog error={authError} onClose={() => { setAuthOpen(false); setAuthError(''); }} onSubmit={onAuth} />}
     {createRoomOpen && <CreateRoomDialog onClose={() => setCreateRoomOpen(false)} onSubmit={createRoom} />}
    {toast && <div className="fixed bottom-5 right-5 z-50 flex max-w-sm items-center gap-3 rounded-lg bg-[#243047] px-4 py-3 text-sm font-semibold text-[#f4f0e7] shadow-xl"><Check size={16} className="text-[#d8e86a]" />{toast}</div>}
  </div>;
}
function AuthDialog({ error, onClose, onSubmit }: { error: string; onClose: () => void; onSubmit: (mode: 'signin' | 'signup', input: { email: string; password: string; displayName?: string }) => Promise<void> }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true); setLocalError('');
    try {
      await onSubmit(mode, { email, password, ...(mode === 'signup' ? { displayName } : {}) });
    } catch (submitError) {
      setLocalError(errorText(submitError));
    } finally { setLoading(false); }
  };
  return <Overlay title={mode === 'signin' ? 'Return to your control room' : 'Create a producer account'} eyebrow="Team access / portable rooms" onClose={onClose}>
    <p className="mb-6 text-sm leading-relaxed text-[#536078]">{mode === 'signin' ? 'Sign in to reopen your production rooms on any browser and collaborate without sharing a room cookie.' : 'Your account owns room membership. Anonymous rooms stay private until you explicitly claim one.'}</p>
    <form className="space-y-4" onSubmit={submit}>
      {mode === 'signup' && <label className="block text-xs font-bold text-[#243047]">Name<input required value={displayName} onChange={event => setDisplayName(event.target.value)} className="mt-1 w-full rounded border border-[#c8c4bb] bg-[#faf7f0] px-3 py-2 text-sm outline-none focus:border-[#e56c4f]" /></label>}
      <label className="block text-xs font-bold text-[#243047]">Email<input required type="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-1 w-full rounded border border-[#c8c4bb] bg-[#faf7f0] px-3 py-2 text-sm outline-none focus:border-[#e56c4f]" /></label>
      <label className="block text-xs font-bold text-[#243047]">Password<input required minLength={8} type="password" value={password} onChange={event => setPassword(event.target.value)} className="mt-1 w-full rounded border border-[#c8c4bb] bg-[#faf7f0] px-3 py-2 text-sm outline-none focus:border-[#e56c4f]" /></label>
      {(localError || error) && <div className="rounded border border-[#e5b5a8] bg-[#f4d2c9] p-3 text-xs text-[#8c382c]">{localError || error}</div>}
      <Button type="submit" variant="lime" className="w-full" disabled={loading}>{loading && <Loader2 size={14} className="animate-spin" />}{mode === 'signin' ? 'Sign in' : 'Create account'}</Button>
    </form>
    <button className="mt-4 w-full text-xs font-bold text-[#536078] hover:text-[#e56c4f]" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setLocalError(''); }}>{mode === 'signin' ? 'Need an account? Create one' : 'Already have an account? Sign in'}</button>
  </Overlay>;
}
function CreateRoomDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      await onSubmit(name.trim());
    } catch (submitError) {
      setError(errorText(submitError));
    } finally {
      setLoading(false);
    }
  };
  return <Overlay title="Create a team room" eyebrow="Workspace / new production" onClose={onClose}>
    <p className="mb-6 text-sm leading-relaxed text-[#536078]">Give this production its own room. You can switch between named productions without mixing schedules, scenarios, or decision history.</p>
    <form className="space-y-4" onSubmit={submit}>
      <label className="block text-xs font-bold text-[#243047]">Room name<input data-testid="input-room-name" required maxLength={120} autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Night Bus — principal photography" className="mt-1 w-full rounded border border-[#c8c4bb] bg-[#faf7f0] px-3 py-3 text-sm outline-none focus:border-[#e56c4f]" /></label>
      {error && <div className="rounded border border-[#e5b5a8] bg-[#f4d2c9] p-3 text-xs text-[#8c382c]">{error}</div>}
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button data-testid="button-create-room" type="submit" variant="lime" disabled={loading || !name.trim()}>{loading && <Loader2 size={14} className="animate-spin" />}{loading ? 'Creating…' : 'Create room'}</Button></div>
    </form>
  </Overlay>;
}

function NavItem({ icon, label, active, onClick }: { icon: ReactNode; label: string; active?: boolean; onClick?: () => void }) { return <button data-testid={`nav-${label.toLowerCase().replaceAll(' ', '-')}`} onClick={onClick} className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-[12px] font-semibold transition ${active ? 'bg-[#d8e86a] text-[#243047]' : 'text-[#b4bfd0] hover:bg-[#31415e] hover:text-[#f4f0e7]'}`}>{icon}{label}</button>; }
function EmptyProduction({ onSample, onIngest, loading, error }: { onSample: () => void; onIngest: () => void; loading: boolean; error: string }) { return <div className="reveal flex min-h-[70vh] items-center justify-center"><div className="max-w-xl text-center"><div className="mx-auto mb-6 flex h-16 w-16 rotate-3 items-center justify-center rounded-2xl bg-[#243047] text-[#d8e86a]"><Film size={30} /></div><div className="mb-3 font-mono text-[10px] uppercase tracking-[.22em] text-[#e56c4f]">Control room awaiting signal</div><h1 className="font-display text-5xl font-bold leading-[.95] tracking-[-.06em] sm:text-7xl">Bring the<br /><span className="text-[#e56c4f]">production</span> in.</h1><p className="mx-auto mt-6 max-w-md text-sm leading-relaxed text-[#536078]">Load the deterministic demo seed to see the time-machine at work, or ingest your own real stripboard and budget notes for a live test.</p>{error && <div className="mx-auto mt-5 max-w-sm rounded border border-[#e5b5a8] bg-[#f4d2c9] p-3 text-left text-xs text-[#8c382c]"><AlertTriangle size={14} className="mb-1" />{error}</div>}<div className="mt-8 flex flex-wrap justify-center gap-3"><Button data-testid="button-load-sample" variant="lime" onClick={onSample} disabled={loading}>{loading && <Loader2 className="animate-spin" size={14} />}<Sparkles size={14} /> Load sample production</Button><Button data-testid="button-open-ingest" variant="ghost" onClick={onIngest}><Upload size={14} /> Ingest documents</Button></div></div></div>; }
function Dashboard({ graph, appliedPlan, onViewApplied, onSimulate, onApply, onAdvisor }: { graph: ProductionGraph; appliedPlan: ApplyResult | null; onViewApplied: () => void; onSimulate: () => void; onApply: () => void; onAdvisor: () => void }) {
  const b = graph.budgetSummary; const used = b.totalBudget && b.spentToDate ? Math.min(100, (b.spentToDate / b.totalBudget) * 100) : 0;
  return <div className="reveal space-y-6"><section className="flex flex-col justify-between gap-5 border-b border-[#d7d3ca] pb-7 lg:flex-row lg:items-end"><div><div className="mb-3 flex flex-wrap items-center gap-2"><StatusPill tone="good"><span className="h-1.5 w-1.5 rounded-full bg-current" />Live graph</StatusPill><span className="font-mono text-[10px] uppercase tracking-widest text-[#7f8898]">Last synced just now</span></div><h1 data-testid="text-production-name" className="font-display text-4xl font-bold tracking-[-.06em] sm:text-6xl">{graph.productionName}</h1><p className="mt-3 max-w-xl text-sm leading-relaxed text-[#536078]">A living schedule. Explore the consequence before it becomes a conversation.</p></div><div className="flex gap-2"><Button data-testid="button-dashboard-advisor" variant="ghost" onClick={onAdvisor}><Bot size={15} /> Ask advisor</Button><Button data-testid="button-dashboard-simulate" variant="dark" onClick={onSimulate}><Zap size={15} /> Run a what-if</Button></div></section>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Remaining" value={money(b.remaining, b.currency)} note={`${b.contingencyPct ?? 0}% contingency held`} accent="lime" /><Metric label="Spent to date" value={money(b.spentToDate, b.currency)} note={`${used.toFixed(1)}% of total budget`} /><Metric label="Production days" value={String(graph.days.length).padStart(2, '0')} note={`${graph.days.filter(d => d.dependencies.length).length} with dependencies`} /><Metric label="Total budget" value={money(b.totalBudget, b.currency)} note="Current approved envelope" /></section>
     <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]"><div className="rounded-lg border border-[#d7d3ca] bg-[#faf7f0]"><div className="flex items-center justify-between border-b border-[#d7d3ca] p-5"><div><div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#e56c4f]">Schedule spine</div><h2 className="font-display mt-1 text-xl font-bold">Shoot days in orbit</h2></div><div className="font-mono text-xs text-[#7f8898]">{graph.days.length} nodes</div></div><div className="divide-y divide-[#e4e0d7]">{graph.days.map((day, index) => <DayRow key={day.id} day={day} index={index} currency={b.currency} />)}</div></div><div className="space-y-4"><BudgetCard budget={b} used={used} />{appliedPlan && <button data-testid="button-view-applied-plan" onClick={onViewApplied} className="w-full rounded-lg border border-[#b9d9d1] bg-[#d3ebe5] p-4 text-left transition hover:border-[#17605b]"><div className="flex items-center justify-between"><div className="font-mono text-[10px] uppercase tracking-widest text-[#17605b]">Plan committed</div><ArrowUpRight size={15} className="text-[#17605b]" /></div><div className="mt-2 text-sm font-bold text-[#243047]">Review the latest applied plan</div><div className="mt-1 text-xs text-[#536078]">Memo, revised schedule, and purchase-order deltas</div></button>}<div className="rounded-lg border border-[#d7d3ca] bg-[#243047] p-5 text-[#f4f0e7]"><div className="mb-4 flex items-center justify-between"><div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#aab5c7]">Agent note</div><Bot size={17} className="text-[#d8e86a]" /></div><p className="font-display text-lg font-semibold leading-snug">“Every moved day is a chain reaction. Run the tape before you pull the thread.”</p><Button data-testid="button-agent-note-simulate" variant="lime" className="mt-5 w-full" onClick={onSimulate}>Open simulation desk <ArrowUpRight size={14} /></Button></div><button data-testid="button-apply-previous" onClick={onApply} className="hidden" /></div></section>
  </div>;
}
function Metric({ label, value, note, accent }: { label: string; value: string; note: string; accent?: string }) { return <div className={`rounded-lg border border-[#d7d3ca] p-4 ${accent === 'lime' ? 'bg-[#d8e86a]' : 'bg-[#faf7f0]'}`}><div className="font-mono text-[10px] uppercase tracking-[.14em] opacity-65">{label}</div><div data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`} className="mt-3 font-display text-3xl font-bold tracking-[-.05em]">{value}</div><div className="mt-2 text-[11px] opacity-65">{note}</div></div>; }
function DayRow({ day, index, currency }: { day: ProductionGraph['days'][number]; index: number; currency: string }) { return <div data-testid={`row-shoot-day-${day.id}`} className="group flex items-center gap-3 px-5 py-4 transition hover:bg-[#f0ece3]"><div className="font-mono text-[11px] text-[#9aa1ac]">{String(index + 1).padStart(2, '0')}</div><div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded bg-[#e7e3d9] text-[#243047]"><span className="font-mono text-[9px] uppercase">{day.date ? new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }) : 'TBD'}</span><b className="font-display text-sm">{day.date ? new Date(day.date + 'T12:00:00').getDate() : '—'}</b></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-sm font-bold">{day.location}</span><StatusPill tone={day.type === 'night' ? 'neutral' : 'good'}>{day.type}</StatusPill></div><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-[#7f8898]"><span>{day.scenes.length} scenes</span><span>{day.crewSize} crew</span><span>{day.callTime ?? 'Call TBD'} – {day.wrapTime ?? 'Wrap TBD'}</span></div></div><div className="hidden text-right sm:block"><div className="font-mono text-xs font-medium">{money(day.baseCost, currency)}</div><div className="mt-1 text-[10px] text-[#9aa1ac]">{day.cast.length} cast</div></div><ChevronRight size={15} className="text-[#b5b8b4] transition group-hover:translate-x-1 group-hover:text-[#e56c4f]" /></div>; }
function BudgetCard({ budget, used }: { budget: ProductionGraph['budgetSummary']; used: number }) { return <div className="rounded-lg border border-[#d7d3ca] bg-[#faf7f0] p-5"><div className="mb-5 flex items-center justify-between"><div><div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#e56c4f]">Budget position</div><h2 className="font-display mt-1 text-xl font-bold">The money, honestly.</h2></div><ShieldCheck size={19} className="text-[#17605b]" /></div><div className="mb-2 flex items-end justify-between"><span className="font-mono text-[11px] text-[#536078]">COMMITTED</span><span className="font-display text-2xl font-bold">{used.toFixed(1)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-[#e4e0d7]"><div className="h-full rounded-full bg-[#e56c4f] transition-all" style={{ width: `${used}%` }} /></div><div className="mt-5 grid grid-cols-2 gap-4 border-t border-[#e4e0d7] pt-4"><div><div className="font-mono text-[10px] text-[#7f8898]">SPENT</div><div className="mt-1 font-display text-lg font-bold">{money(budget.spentToDate, budget.currency)}</div></div><div><div className="font-mono text-[10px] text-[#7f8898]">RESERVE</div><div className="mt-1 font-display text-lg font-bold text-[#17605b]">{money(budget.remaining, budget.currency)}</div></div></div></div>; }
function IngestModal({ onClose, onSubmit, loading, error }: { onClose: () => void; onSubmit: (input: IngestInput) => void; loading: boolean; error: string }) {
  const [text, setText] = useState('');
  const [filename, setFilename] = useState('');
  const [mimeType, setMimeType] = useState('');
  const [fileData, setFileData] = useState('');
  const [fileError, setFileError] = useState('');
  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setFilename(file.name);
      if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid file data'));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        setMimeType(file.type);
        setFileData(dataUrl.slice(dataUrl.indexOf(',') + 1));
        setText('');
      } else {
        setText(await file.text());
        setMimeType('');
        setFileData('');
      }
      setFileError('');
    } catch {
      setMimeType('');
      setFileData('');
      setFileError('That document could not be read. Choose another file or paste the schedule instead.');
    }
  };
  return <Overlay title="Ingest a production" eyebrow="Document relay / parse" onClose={onClose}>
    <p className="mb-6 max-w-lg text-sm leading-relaxed text-[#536078]">Drop in a stripboard export, budget notes, or a plain-language schedule. The parsing agent turns it into a graph you can inspect before making a move.</p>
    <label className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-[#536078]">Document file <span className="text-[#9aa1ac]">(PDF, image, text, CSV, JSON, or Markdown)</span></label>
    <input data-testid="input-ingest-file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.txt,.csv,.json,.md,application/pdf,image/jpeg,image/png,image/webp,image/gif,text/plain,text/csv,application/json,text/markdown" onChange={readFile} className="mb-3 block w-full rounded-md border border-dashed border-[#c8c4bb] bg-[#faf7f0] px-3 py-3 text-xs text-[#536078] file:mr-3 file:rounded file:border-0 file:bg-[#e7e3d9] file:px-3 file:py-2 file:text-xs file:font-bold file:text-[#243047]" />
    {fileData && <div data-testid="status-multimodal-file" className="mb-5 rounded bg-[#d3ebe5] px-3 py-2 text-xs font-semibold text-[#17605b]"><Film size={13} className="mr-2 inline" />Raw {mimeType === 'application/pdf' ? 'PDF' : 'image'} bytes ready for Gemini multimodal analysis.</div>}
    <label className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-[#536078]">Source label <span className="text-[#9aa1ac]">(optional)</span></label>
    <input data-testid="input-ingest-filename" value={filename} onChange={e => setFilename(e.target.value)} placeholder="e.g. shooting-schedule-v4.csv" className="mb-5 w-full rounded-md border border-[#c8c4bb] bg-[#faf7f0] px-3 py-3 text-sm outline-none transition focus:border-[#e56c4f] focus:ring-2 focus:ring-[#e56c4f]/20" />
    <label className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-[#536078]">{fileData ? 'Optional context for the uploaded document' : 'Production text'}</label>
    <textarea data-testid="input-ingest-text" value={text} onChange={e => setText(e.target.value)} placeholder={fileData ? 'Add any context Gemini should know about this document…' : 'Paste at least 10 characters of your schedule and budget notes…'} rows={9} className="w-full resize-y rounded-md border border-[#c8c4bb] bg-[#faf7f0] px-3 py-3 text-sm leading-relaxed outline-none transition focus:border-[#e56c4f] focus:ring-2 focus:ring-[#e56c4f]/20" />
    {(fileError || error) && <div className="mt-3 rounded bg-[#f4d2c9] p-3 text-xs text-[#8c382c]">{fileError || error}</div>}
    <div className="mt-6 flex justify-end gap-2"><Button data-testid="button-cancel-ingest" variant="ghost" onClick={onClose}>Cancel</Button><Button data-testid="button-submit-ingest" variant="dark" disabled={loading || (!fileData && text.trim().length < 10)} onClick={() => onSubmit({ text: text.trim() || null, filename: filename || null, mimeType: mimeType || null, fileData: fileData || null })}>{loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Parse production</Button></div>
  </Overlay>;
}
function SimulateModal({ graph, preset, onClose, onSubmit, loading }: { graph: ProductionGraph; preset?: { dayId: string; changeType: string }; onClose: () => void; onSubmit: (dayId: string, type: string, details: Record<string, string>) => void; loading: boolean }) {
  const [dayId, setDayId] = useState(preset?.dayId ?? graph.days[0]?.id ?? '');
  const [type, setType] = useState(preset?.changeType ?? 'move_day');
  const [newDate, setNewDate] = useState('');
  const [sceneToCut, setSceneToCut] = useState('');
  const [castMemberToCut, setCastMemberToCut] = useState('');
  const selected = graph.days.find(d => d.id === dayId);
  const details: Record<string, string> = {};
  if (type === 'move_day' && newDate) details.newDate = newDate;
  if (type === 'cut_scene' && sceneToCut) details.sceneToCut = sceneToCut;
  if (type === 'cut_cast_day' && castMemberToCut) details.castMemberToCut = castMemberToCut;
  return <Overlay title="Simulation desk" eyebrow="What-if / no changes applied" onClose={onClose} wide><div className="mb-7 rounded-md border border-[#d7d3ca] bg-[#243047] p-5 text-[#f4f0e7]"><div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-[#d8e86a]"><Zap size={13} /> Safe to explore</div><p className="text-sm leading-relaxed text-[#cad2dc]">Nothing moves until you confirm. The agents will map the cascade, cost delta, and creative risk first.</p></div><div className="grid gap-5 sm:grid-cols-2"><div><label className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-[#536078]">Anchor day</label><select data-testid="select-simulation-day" value={dayId} onChange={e => { setDayId(e.target.value); setSceneToCut(''); setCastMemberToCut(''); }} className="w-full rounded-md border border-[#c8c4bb] bg-[#faf7f0] px-3 py-3 text-sm outline-none focus:border-[#e56c4f]">{graph.days.map(d => <option value={d.id} key={d.id}>{dateLabel(d.date)} · {d.location}</option>)}</select>{selected && <div className="mt-3 rounded bg-[#e7e3d9] p-3 text-xs leading-relaxed text-[#536078]">{selected.scenes.length} scenes · {selected.cast.length} cast · {selected.dependencies.length} dependencies</div>}</div><div><label className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-[#536078]">Change to model</label><select data-testid="select-simulation-change" value={type} onChange={e => { setType(e.target.value); setSceneToCut(''); setCastMemberToCut(''); }} className="w-full rounded-md border border-[#c8c4bb] bg-[#faf7f0] px-3 py-3 text-sm outline-none focus:border-[#e56c4f]"><option value="move_day">Move shoot day</option><option value="cut_scene">Cut a scene</option><option value="cut_cast_day">Cut cast from day</option><option value="cut_location">Cut location</option><option value="convert_to_day_for_night">Convert night to day</option></select>{type === 'move_day' && <input data-testid="input-simulation-date" type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="mt-3 w-full rounded-md border border-[#c8c4bb] bg-[#faf7f0] px-3 py-3 text-sm outline-none focus:border-[#e56c4f]" />}{type === 'cut_scene' && <select data-testid="select-simulation-scene" value={sceneToCut} onChange={e => setSceneToCut(e.target.value)} className="mt-3 w-full rounded-md border border-[#c8c4bb] bg-[#faf7f0] px-3 py-3 text-sm outline-none focus:border-[#e56c4f]"><option value="">Choose a scene</option>{selected?.scenes.map(scene => <option value={scene} key={scene}>{scene}</option>)}</select>}{type === 'cut_cast_day' && <select data-testid="select-simulation-cast" value={castMemberToCut} onChange={e => setCastMemberToCut(e.target.value)} className="mt-3 w-full rounded-md border border-[#c8c4bb] bg-[#faf7f0] px-3 py-3 text-sm outline-none focus:border-[#e56c4f]"><option value="">Choose a cast member</option>{selected?.cast.map(cast => <option value={cast} key={cast}>{cast}</option>)}</select>}</div></div><div className="mt-8 flex justify-end gap-2"><Button data-testid="button-cancel-simulation" variant="ghost" onClick={onClose}>Cancel</Button><Button data-testid="button-run-simulation" variant="coral" disabled={loading || !dayId || (type === 'move_day' && !newDate) || (type === 'cut_scene' && !sceneToCut) || (type === 'cut_cast_day' && !castMemberToCut)} onClick={() => onSubmit(dayId, type, details)}>{loading ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Run simulation</Button></div></Overlay>;
}

function ApplyModal({ simulation, loading, onClose, onApply }: { simulation: SimulationResult; loading: boolean; onClose: () => void; onApply: () => void }) {
  const { cascade, impact } = simulation;
  return <Overlay title="Review before commit" eyebrow="Plan agent / confirmation required" onClose={onClose} wide>
    <div className={`mb-5 flex items-start gap-3 rounded-md border p-4 ${impact.overBudget ? 'border-[#e5b5a8] bg-[#f4d2c9]' : 'border-[#b9d9d1] bg-[#d3ebe5]'}`}><AlertTriangle size={18} className={impact.overBudget ? 'text-[#a33d2f]' : 'text-[#17605b]'} /><div><div className="text-sm font-bold">{impact.overBudget ? 'This revision crosses the approved envelope.' : 'This revision stays inside the approved envelope.'}</div><p className="mt-1 text-xs leading-relaxed text-[#536078]">{cascade.summary}</p></div></div>
    <div className="grid gap-3 sm:grid-cols-3"><Impact label="Cost delta" value={`${impact.costDelta >= 0 ? '+' : ''}${money(impact.costDelta)}`} tone={impact.costDelta > 0 ? 'warn' : 'good'} /><Impact label="Days delta" value={`${impact.daysDelta >= 0 ? '+' : ''}${impact.daysDelta}`} tone={impact.daysDelta > 0 ? 'warn' : 'good'} /><Impact label="Projected remaining" value={money(impact.projectedRemaining)} tone={impact.overBudget ? 'danger' : 'good'} /></div>
    <div className="mt-7 grid gap-7 md:grid-cols-2"><div><div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[#e56c4f]">Cascade / {cascade.affectedDays.length} affected</div>{cascade.affectedDays.length ? <div className="space-y-2">{cascade.affectedDays.map(item => <div key={item.dayId} className="flex items-start gap-3 rounded border border-[#d7d3ca] bg-[#faf7f0] p-3"><div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.severity === 'high' ? 'bg-[#e56c4f]' : item.severity === 'medium' ? 'bg-[#d8c94e]' : 'bg-[#71bdb4]'}`} /><div><div className="font-mono text-[11px] font-medium">{item.dayId}</div><div className="mt-1 text-xs leading-relaxed text-[#536078]">{item.reason}</div></div></div>)}</div> : <EmptyState icon={<Check size={15} />} text="No other shoot days move." />}</div><div><div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[#e56c4f]">Why the agent said that</div><div className="space-y-2">{impact.appliedRules.map((rule, i) => <div key={`${rule.rule}-${i}`} className="rounded border border-[#d7d3ca] bg-[#faf7f0] p-3"><div className="flex items-start gap-2 text-xs font-bold"><Settings2 size={13} className="mt-0.5 shrink-0 text-[#e56c4f]" />{rule.rule}</div><p className="mt-2 pl-5 text-xs leading-relaxed text-[#536078]">{rule.justification}</p></div>)}{impact.riskFlags.length > 0 && <div className="mt-3 rounded border border-[#e5b5a8] bg-[#f4d2c9] p-3"><div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[#a33d2f]">Risk flags</div>{impact.riskFlags.map(flag => <div key={flag} className="flex gap-2 text-xs text-[#8c382c]"><AlertTriangle size={13} />{flag}</div>)}</div>}</div></div></div>
    <div className="mt-8 flex flex-col-reverse justify-between gap-3 border-t border-[#d7d3ca] pt-5 sm:flex-row sm:items-center"><div className="flex items-center gap-2 text-xs text-[#536078]"><ShieldCheck size={15} className="text-[#17605b]" />The decision and rationale will be logged.</div><div className="flex gap-2"><Button data-testid="button-cancel-apply" variant="ghost" onClick={onClose}>Keep exploring</Button><Button data-testid="button-confirm-apply" variant={impact.overBudget ? 'coral' : 'lime'} disabled={loading} onClick={onApply}>{loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Commit revised plan</Button></div></div>
  </Overlay>;
}
function Impact({ label, value, tone }: { label: string; value: string; tone: 'good' | 'warn' | 'danger' }) { return <div className="rounded border border-[#d7d3ca] bg-[#faf7f0] p-4"><div className="font-mono text-[10px] uppercase tracking-widest text-[#7f8898]">{label}</div><div className={`mt-2 font-display text-2xl font-bold ${tone === 'good' ? 'text-[#17605b]' : tone === 'danger' ? 'text-[#a33d2f]' : 'text-[#8d781d]'}`}>{value}</div></div>; }
function EmptyState({ icon, text }: { icon: ReactNode; text: string }) { return <div className="rounded border border-dashed border-[#c8c4bb] p-5 text-center text-xs text-[#7f8898]"><div className="mx-auto mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-[#e7e3d9] text-[#17605b]">{icon}</div>{text}</div>; }

function advisorChangeType(action: string) {
  const lower = action.toLowerCase();
  if (lower.includes('location')) return 'cut_location';
  if (lower.includes('night')) return 'convert_to_day_for_night';
  if (lower.includes('cast') || lower.includes('actor')) return 'cut_cast_day';
  return 'cut_scene';
}
function AdvisorDrawer({ roomKey, onClose, onSimulate }: { roomKey: string; onClose: () => void; onSimulate: (dayId: string, changeType: string) => void }) {
  const advisor = useGetAdvisorRecommendations({ query: { queryKey: ['/api/advisor', roomKey] } });
  return <Overlay title="The advisor's desk" eyebrow="Leverage scan / current graph" onClose={onClose} wide>{advisor.isLoading ? <Skeleton /> : advisor.isError ? <ErrorState text={errorText(advisor.error)} retry={advisor.refetch} /> : advisor.data ? <><div className="mb-7 rounded-md bg-[#d8e86a] p-5"><div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-[#536078]"><Sparkles size={13} /> Recommendation brief</div><p className="font-display text-xl font-bold leading-snug text-[#243047]">{advisor.data.headline}</p></div><div className="space-y-3">{advisor.data.recommendations.map(rec => <div key={`${rec.rank}-${rec.title}`} className="rounded-md border border-[#d7d3ca] bg-[#faf7f0] p-4 transition hover:border-[#e56c4f]"><div className="flex items-start gap-3"><div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[#243047] font-mono text-xs text-[#d8e86a]">0{rec.rank}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold">{rec.title}</h3><StatusPill tone={rec.creativeRisk === 'high' ? 'danger' : rec.creativeRisk === 'medium' ? 'warn' : 'good'}>{rec.creativeRisk} creative risk</StatusPill></div><p className="mt-2 text-xs leading-relaxed text-[#536078]">{rec.rationale}</p><div className="mt-3 flex items-center justify-between gap-3"><span className="font-mono text-[11px] text-[#17605b]">Save {money(rec.estimatedSavings)}</span><Button data-testid={`button-advisor-simulate-${rec.dayId}`} variant="ghost" className="px-2 py-1 text-[10px]" onClick={() => onSimulate(rec.dayId, advisorChangeType(rec.action))}>Model this <ArrowUpRight size={12} /></Button></div></div></div></div>)}</div>{advisor.data.recommendations.length === 0 && <EmptyState icon={<CircleHelp size={15} />} text="No interventions surfaced for this graph." />}</> : <EmptyState icon={<CircleHelp size={15} />} text="No advisor brief yet." />}</Overlay>;
}
function ScenariosDrawer({ roomKey, graph, onClose, notify }: { roomKey: string; graph?: ProductionGraph; onClose: () => void; notify: (text: string) => void }) {
  const scenarios = useListScenarios({ query: { queryKey: [...getListScenariosQueryKey(), roomKey] } }); const save = useSaveScenario(); const load = useLoadScenario(); const remove = useDeleteScenario(); const [name, setName] = useState(''); const [compare, setCompare] = useState<[string, string]>(['', '']); const params = useMemo(() => ({ a: compare[0], b: compare[1] }), [compare]); const comparison = useCompareScenarios(params, { query: { enabled: Boolean(compare[0] && compare[1]), queryKey: ['/api/scenarios/compare', params.a, params.b, roomKey] } });
  const refresh = () => queryClient.invalidateQueries({ queryKey: [...getListScenariosQueryKey(), roomKey] });
  return <Overlay title="Scenario shelf" eyebrow="Versions / alternate cuts" onClose={onClose} wide><div className="mb-7 flex flex-col gap-3 rounded-md border border-[#d7d3ca] bg-[#faf7f0] p-4 sm:flex-row"><input data-testid="input-scenario-name" value={name} onChange={e => setName(e.target.value)} placeholder="Name this version…" className="min-w-0 flex-1 rounded border border-[#c8c4bb] bg-[#f4f0e7] px-3 py-2 text-sm outline-none focus:border-[#e56c4f]" /><Button data-testid="button-save-scenario" variant="dark" disabled={!name.trim() || save.isPending || !graph} onClick={() => save.mutate({ data: { name: name.trim() } }, { onSuccess: () => { setName(''); refresh(); notify('Scenario saved to the shelf.'); }, onError: e => notify(errorText(e)) })}>{save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Save current</Button></div>{scenarios.isLoading ? <Skeleton /> : scenarios.isError ? <ErrorState text={errorText(scenarios.error)} retry={scenarios.refetch} /> : !scenarios.data?.length ? <EmptyState icon={<Archive size={15} />} text="Saved scenarios will appear here." /> : <><div className="space-y-2">{scenarios.data.map(s => <div key={s.id} className="flex items-center gap-3 rounded border border-[#d7d3ca] bg-[#faf7f0] p-3"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[#e7e3d9]"><FileClock size={15} className="text-[#e56c4f]" /></div><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{s.name}</div><div className="mt-1 font-mono text-[10px] text-[#7f8898]">{s.dayCount} days · {money(s.remaining)} remaining · {dateLabel(s.createdAt)}</div></div><Button data-testid={`button-load-scenario-${s.id}`} variant="ghost" className="px-2 py-1 text-[10px]" disabled={load.isPending} onClick={() => load.mutate({ id: s.id }, { onSuccess: result => { queryClient.setQueryData(getGetProductionGraphQueryKey(), result); onClose(); notify(`Loaded ${s.name}.`); }, onError: e => notify(errorText(e)) })}>Load</Button><button data-testid={`button-delete-scenario-${s.id}`} className="rounded p-2 text-[#9aa1ac] hover:bg-[#f4d2c9] hover:text-[#a33d2f]" onClick={() => remove.mutate({ id: s.id }, { onSuccess: () => { refresh(); notify('Scenario removed.'); }, onError: e => notify(errorText(e)) })}><Trash2 size={14} /></button></div>)}</div><div className="mt-7 border-t border-[#d7d3ca] pt-5"><div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[#e56c4f]">Compare two versions</div><div className="flex flex-col gap-2 sm:flex-row"><select data-testid="select-compare-a" value={compare[0]} onChange={e => setCompare([e.target.value, compare[1]])} className="flex-1 rounded border border-[#c8c4bb] bg-[#faf7f0] px-2 py-2 text-xs"><option value="">Version A</option>{scenarios.data.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><select data-testid="select-compare-b" value={compare[1]} onChange={e => setCompare([compare[0], e.target.value])} className="flex-1 rounded border border-[#c8c4bb] bg-[#faf7f0] px-2 py-2 text-xs"><option value="">Version B</option>{scenarios.data.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>{comparison.isFetching && <div className="mt-3 text-xs text-[#536078]">Running comparison…</div>}{comparison.data && <div className="mt-3 rounded bg-[#d3ebe5] p-4 text-sm"><div className="font-bold">{comparison.data.summary}</div><div className="mt-3 grid grid-cols-2 gap-3 font-mono text-[10px] text-[#17605b]"><span>Cost delta: {money(comparison.data.diff.costDelta)}</span><span>Days delta: {comparison.data.diff.dayCountDelta}</span></div></div>}</div></>}</Overlay>;
}
function LogDrawer({ roomKey, onClose }: { roomKey: string; onClose: () => void }) { const log = useGetDecisionLog({ query: { queryKey: [...getGetDecisionLogQueryKey(), roomKey] } }); return <Overlay title="Decision log" eyebrow="Governance trail / recorded reasoning" onClose={onClose} wide>{log.isLoading ? <Skeleton /> : log.isError ? <ErrorState text={errorText(log.error)} retry={log.refetch} /> : !log.data?.length ? <EmptyState icon={<History size={15} />} text="No agent decisions recorded yet." /> : <div className="relative space-y-3 before:absolute before:bottom-2 before:left-3 before:top-2 before:w-px before:bg-[#d7d3ca]">{log.data.map(entry => <div key={entry.id} className="relative pl-8"><div className="absolute left-0 top-3 h-6 w-6 rounded-full border-4 border-[#f4f0e7] bg-[#e56c4f]" /><div className="rounded border border-[#d7d3ca] bg-[#faf7f0] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-[10px] uppercase tracking-widest text-[#e56c4f]">{entry.agent}</span><span className="font-mono text-[10px] text-[#9aa1ac]">{new Date(entry.timestamp).toLocaleString()}</span></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><CodeBlock label="Input" value={entry.input} /><CodeBlock label="Output" value={entry.output} /></div></div></div>)}</div>}</Overlay>; }
function CodeBlock({ label, value }: { label: string; value: Record<string, unknown> }) { return <div className="rounded bg-[#e7e3d9] p-3"><div className="mb-1 font-mono text-[9px] uppercase tracking-widest text-[#7f8898]">{label}</div><pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-[#536078]">{JSON.stringify(value, null, 2)}</pre></div>; }
function AppliedPlanDrawer({ result, onClose }: { result: ApplyResult; onClose: () => void }) { return <Overlay title="Applied plan" eyebrow="Handoff / confirmed revision" onClose={onClose} wide><div className="rounded-md border border-[#b9d9d1] bg-[#d3ebe5] p-5"><div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-[#17605b]"><Check size={13} /> Confirmed and logged</div><p className="text-sm leading-relaxed text-[#536078]">This revision is now part of the active production graph. Review the handoff artifacts below before distributing them.</p></div><section className="mt-6"><div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[#e56c4f]">Producer memo</div><div data-testid="text-producer-memo" className="rounded border border-[#d7d3ca] bg-[#faf7f0] p-4 text-sm leading-relaxed text-[#536078]">{result.producerMemo}</div></section><section className="mt-6"><div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[#e56c4f]">Revised schedule</div><div data-testid="text-revised-schedule" className="rounded border border-[#d7d3ca] bg-[#faf7f0] p-4 text-sm leading-relaxed text-[#536078] whitespace-pre-wrap">{result.revisedScheduleSummary}</div></section><section className="mt-6"><div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[#e56c4f]">Purchase-order deltas</div>{result.purchaseOrderDeltas.length ? <div className="space-y-2">{result.purchaseOrderDeltas.map((delta, index) => <div data-testid={`row-purchase-order-delta-${index}`} key={`${delta.vendor}-${index}`} className="flex items-start justify-between gap-4 rounded border border-[#d7d3ca] bg-[#faf7f0] p-3 text-xs"><div><b>{delta.vendor}</b><div className="mt-1 text-[#536078]">{delta.description}</div></div><span className={delta.amountDelta > 0 ? 'text-[#a33d2f]' : 'text-[#17605b]'}>{money(delta.amountDelta)}</span></div>)}</div> : <EmptyState icon={<Check size={15} />} text="No purchase-order changes returned." />}</section></Overlay>; }
function ExportDrawer({ roomKey, graph, onClose, notify }: { roomKey: string; graph: ProductionGraph; onClose: () => void; notify: (text: string) => void }) { const download = () => { window.location.assign(`/api/export?roomId=${encodeURIComponent(roomKey)}`); notify('Export pack download started.'); onClose(); }; return <Overlay title="Export production pack" eyebrow="Handoff / complete archive" onClose={onClose}><div className="rounded-md bg-[#243047] p-5 text-[#f4f0e7]"><div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-[#d8e86a]"><Download size={13} /> Ready for handoff</div><p className="text-sm leading-relaxed text-[#cad2dc]">Download a ZIP containing the active graph, applied plans, decision log, saved scenarios, and a handoff README.</p></div><div className="my-6 space-y-2 text-xs text-[#536078]"><div className="flex justify-between border-b border-[#d7d3ca] py-2"><span>Production</span><b>{graph.productionName}</b></div><div className="flex justify-between border-b border-[#d7d3ca] py-2"><span>Schedule nodes</span><b>{graph.days.length}</b></div><div className="flex justify-between border-b border-[#d7d3ca] py-2"><span>Budget position</span><b>{money(graph.budgetSummary.remaining, graph.budgetSummary.currency)} remaining</b></div></div><Button data-testid="button-download-export" variant="dark" className="w-full" onClick={download}><Download size={15} /> Download complete ZIP pack</Button><button data-testid="button-cancel-export" onClick={onClose} className="mt-3 w-full py-2 text-xs font-bold text-[#536078]">Cancel</button></Overlay>; }
function ErrorState({ text, retry }: { text: string; retry: () => void }) { return <div className="rounded border border-[#e5b5a8] bg-[#f4d2c9] p-4 text-sm text-[#8c382c]"><div className="flex items-center gap-2 font-bold"><AlertTriangle size={15} /> Could not read this station.</div><p className="mt-1 text-xs">{text}</p><Button data-testid="button-retry" variant="ghost" className="mt-3 px-2 py-1 text-[10px]" onClick={retry}><RefreshCw size={12} /> Retry</Button></div>; }

function Router() { return <ErrorBoundary resetKey={location.pathname}><Switch><Route path="/" component={AppShell} /><Route component={NotFound} /></Switch></ErrorBoundary>; }
function App() { return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>; }
export default App;