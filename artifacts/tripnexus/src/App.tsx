import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import {
  useHealthCheck, useGetAgents, useGetDestinations, useGetDemoScenarios,
  usePlanTrip, useGetPlanningRun, useGetRunTrace, useGetDocumentationPdf,
  getGetPlanningRunQueryKey, getGetRunTraceQueryKey, getGetDocumentationPdfQueryKey,
  type TripRequest, type TripPlanResult, type TraceEvent,
} from '@workspace/api-client-react';
import { z } from 'zod';
import {
  Activity, ArrowDownToLine, ArrowRight, BadgeCheck, CalendarDays, Check, ChevronDown,
  CircleAlert, Compass, Download, FileJson2, HeartPulse, MapPin, Menu, MessageSquareText,
  Plane, RotateCcw, Search, Sparkles, Sun, Users, Wallet,
} from 'lucide-react';

const queryClient = new QueryClient();

const requestSchema = z.object({
  destinationId: z.string().min(2, 'Choose a supported destination.'),
  origin: z.string().max(120).optional(),
  startDate: z.string().min(1, 'Choose a departure date.'),
  endDate: z.string().min(1, 'Choose a return date.'),
  travelers: z.number().int().min(1).max(12),
  budgetInr: z.number().min(1000).max(10000000),
  interests: z.array(z.string()).max(8),
  activityPreferences: z.array(z.string()).max(8),
  pace: z.enum(['relaxed', 'balanced', 'packed']),
  notes: z.string().max(500).optional(),
}).refine((form) => form.endDate >= form.startDate, {
  message: 'Return date must be after departure.', path: ['endDate'],
});

type RequestDraft = {
  destinationId: string; origin: string; startDate: string; endDate: string;
  travelers: string; budgetInr: string; interests: string; activityPreferences: string;
  pace: 'relaxed' | 'balanced' | 'packed'; notes: string;
};

const blankDraft: RequestDraft = {
  destinationId: '', origin: '', startDate: '', endDate: '', travelers: '2',
  budgetInr: '85000', interests: 'local food, architecture, nature',
  activityPreferences: 'walking, markets, cultural sites', pace: 'balanced', notes: '',
};

function money(amount: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}
function dateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}
function splitTags(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 8);
}
function errorMessage(error: unknown) {
  if (error && typeof error === 'object') {
    const apiError = error as { error?: unknown; setupInstruction?: unknown; code?: unknown; data?: unknown };
    const data = apiError.data && typeof apiError.data === 'object'
      ? apiError.data as { error?: unknown; setupInstruction?: unknown; code?: unknown }
      : undefined;
    const code = typeof apiError.code === 'string' ? apiError.code : data?.code;
    const message = typeof apiError.error === 'string' ? apiError.error : data?.error;
    const setup = typeof apiError.setupInstruction === 'string' ? apiError.setupInstruction : data?.setupInstruction;
    if (typeof message === 'string') {
      return [typeof code === 'string' ? `${code}:` : '', message, typeof setup === 'string' ? setup : '']
        .filter(Boolean)
        .join(' ');
    }
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function AppWorkspace() {
  const health = useHealthCheck();
  const agents = useGetAgents();
  const destinations = useGetDestinations();
  const demos = useGetDemoScenarios();
  const planner = usePlanTrip();
  const [draft, setDraft] = useState<RequestDraft>(blankDraft);
  const [runId, setRunId] = useState('');
  const [lastRequest, setLastRequest] = useState<TripRequest | null>(null);
  const [traceSearch, setTraceSearch] = useState('');
  const [traceFilter, setTraceFilter] = useState('all');
  const [showTrace, setShowTrace] = useState(false);
  const [loadDocumentation, setLoadDocumentation] = useState(false);
  const [formError, setFormError] = useState('');
  const [mobileMenu, setMobileMenu] = useState(false);

  const planningRun = useGetPlanningRun(runId, {
    query: {
      enabled: Boolean(runId),
      queryKey: getGetPlanningRunQueryKey(runId),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === 'completed' || status === 'failed' ? false : 1500;
      },
      refetchIntervalInBackground: true,
    },
  });
  const result: TripPlanResult | null = planningRun.data?.status === 'completed'
    ? planningRun.data.result
    : null;
  const offlinePlan = result?.mode === 'offline_fallback';
  const runFailure = planningRun.data?.status === 'failed' ? planningRun.data.error : null;
  const planningError = runFailure
    ? [`${runFailure.code} (${runFailure.statusCode}):`, runFailure.error, runFailure.setupInstruction].filter(Boolean).join(' ')
    : planningRun.isError
      ? errorMessage(planningRun.error)
      : planner.isError
        ? errorMessage(planner.error)
        : '';
  const providerThrottled = Boolean(planningError && /429|rate.?limit|throttl/i.test(planningError));
  const formProviderThrottled = Boolean(formError && /429|rate.?limit|throttl/i.test(formError));
  const isPlanning = planner.isPending || Boolean(
    runId
    && !planningRun.isError
    && !runFailure
    && (planningRun.data?.status === 'queued' || planningRun.data?.status === 'running' || !planningRun.data),
  );

  const trace = useGetRunTrace(runId, {
    query: { enabled: Boolean(runId && result && !result.executionTrace?.length), queryKey: getGetRunTraceQueryKey(runId), staleTime: 0 },
  });
  const documentation = useGetDocumentationPdf({
    query: { enabled: loadDocumentation, queryKey: getGetDocumentationPdfQueryKey(), staleTime: 0 },
  });

  useEffect(() => {
    if (!loadDocumentation || !documentation.data) return;
    const href = URL.createObjectURL(documentation.data);
    const link = document.createElement('a');
    link.href = href;
    link.download = 'tripnexus-project-documentation.pdf';
    link.click();
    URL.revokeObjectURL(href);
    setLoadDocumentation(false);
  }, [documentation.data, loadDocumentation]);

  const traceEvents = trace.data?.events ?? result?.executionTrace ?? [];
  const filteredEvents = useMemo(() => traceEvents.filter((event) => {
    const matchesQuery = `${event.agentId} ${event.eventType} ${event.summary} ${event.action ?? ''} ${event.toolName ?? ''}`.toLowerCase().includes(traceSearch.toLowerCase());
    return matchesQuery && (traceFilter === 'all' || event.status.toLowerCase() === traceFilter.toLowerCase() || event.eventType.toLowerCase() === traceFilter.toLowerCase());
  }), [traceEvents, traceSearch, traceFilter]);

  const updateDraft = (key: keyof RequestDraft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const startPlanning = (request: TripRequest) => {
    setFormError('');
    setLastRequest(request);
    setRunId('');
    setShowTrace(true);
    planner.reset();
    planner.mutate({ data: request }, {
      onSuccess: (response) => { setRunId(response.runId); },
      onError: (error) => setFormError(errorMessage(error)),
    });
  };
  const selectScenario = (scenarioId: string) => {
    const scenario = demos.data?.find((item) => item.id === scenarioId);
    if (!scenario) return;
    const request = scenario.request;
    setDraft({
      destinationId: request.destinationId, origin: request.origin ?? '',
      startDate: request.startDate, endDate: request.endDate, travelers: String(request.travelers),
      budgetInr: String(request.budgetInr), interests: request.interests.join(', '),
      activityPreferences: request.activityPreferences.join(', '), pace: request.pace, notes: request.notes ?? '',
    });
    setFormError('');
  };

  const submitTrip = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = requestSchema.safeParse({
      destinationId: draft.destinationId, origin: draft.origin || undefined,
      startDate: draft.startDate, endDate: draft.endDate, travelers: Number(draft.travelers),
      budgetInr: Number(draft.budgetInr), interests: splitTags(draft.interests),
      activityPreferences: splitTags(draft.activityPreferences), pace: draft.pace,
      notes: draft.notes || undefined,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Check the trip details and try again.');
      return;
    }
    startPlanning(parsed.data as TripRequest);
  };

  const exportTrace = () => {
    const payload = trace.data ?? (result ? { runId: result.runId, mode: result.mode, events: result.executionTrace, messages: result.messages } : null);
    if (!payload) return;
    const href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = href;
    link.download = `tripnexus-trace-${payload.runId}.json`;
    link.click();
    URL.revokeObjectURL(href);
  };

  const jumpTo = (id: string) => {
    setMobileMenu(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const downloadDocumentation = () => {
    if (documentation.isError) {
      void documentation.refetch();
      return;
    }
    setLoadDocumentation(true);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a href="#top" className="brand" aria-label="TripNexus home">
          <span className="brand-mark"><Compass size={20} strokeWidth={2.1} /></span>
          <span>trip<span>nexus</span></span>
        </a>
        <nav className={mobileMenu ? 'main-nav nav-open' : 'main-nav'} aria-label="Main navigation">
          <button onClick={() => jumpTo('planner')}>Plan a trip</button>
          <button onClick={() => jumpTo('agents')}>Your crew</button>
          <button onClick={() => jumpTo('trace')}>Run trace</button>
        </nav>
        <div className="top-actions">
          <div className="health-mini" aria-live="polite">
            <i className={health.data?.status === 'ok' || health.data?.status === 'healthy' ? 'status-dot is-up' : health.isError ? 'status-dot is-down' : 'status-dot'} />
            <span>{health.isLoading ? 'Checking API' : health.isError ? 'API unavailable' : 'API connected'}</span>
          </div>
          <button className="docs-top" onClick={downloadDocumentation} disabled={documentation.isFetching} data-testid="button-download-docs">
            <Download size={15} /> <span>{documentation.isFetching ? 'Preparing…' : 'Docs PDF'}</span>
          </button>
          <button className="menu-toggle" aria-label={mobileMenu ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileMenu} onClick={() => setMobileMenu(!mobileMenu)}><Menu size={21} /></button>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> YOUR NEXT GREAT STORY STARTS HERE</div>
            <h1>Travel, thoughtfully<br /><em>put together.</em></h1>
            <p>Five specialist agents. One considered itinerary. Tell us what kind of trip feels like you.</p>
            <button className="hero-cta" onClick={() => jumpTo('planner')}>Build your itinerary <ArrowRight size={16} /></button>
          </div>
          <div className="hero-graphic" aria-hidden="true">
            <div className="route-stamp">FIELD NOTES<br /><strong>NO. 024</strong></div>
            <svg className="route-map" viewBox="0 0 540 260" fill="none">
              <path d="M37 197C109 180 128 93 205 124C274 152 292 56 369 84C427 106 427 157 503 50" stroke="rgba(224,230,210,.58)" strokeWidth="1.6" strokeDasharray="5 8" />
              <circle cx="37" cy="197" r="5" fill="#F6D957" /><circle cx="205" cy="124" r="5" fill="#65B6A7" /><circle cx="369" cy="84" r="5" fill="#F6D957" /><circle cx="503" cy="50" r="6" fill="#E98775" />
              <path d="M226 35c-4.2 0-7.5 3.3-7.5 7.5 0 5.6 7.5 14 7.5 14s7.5-8.4 7.5-14c0-4.2-3.3-7.5-7.5-7.5Z" fill="#F6D957" /><circle cx="226" cy="42.5" r="2.4" fill="#15263B" />
              <path d="M408 174c-4.2 0-7.5 3.3-7.5 7.5 0 5.6 7.5 14 7.5 14s7.5-8.4 7.5-14c0-4.2-3.3-7.5-7.5-7.5Z" fill="#65B6A7" /><circle cx="408" cy="181.5" r="2.4" fill="#15263B" />
            </svg>
            <div className="hero-note"><Plane size={14} /> THE LONG WAY IS OFTEN THE GOOD WAY</div>
            <span className="hero-coordinate">19°04' N&nbsp; 72°52' E</span>
          </div>
          <div className="hero-bottom"><span>MADE FOR THE CURIOUS</span><Sparkles size={12} aria-hidden="true" /><span>POWERED BY FIVE SPECIALISTS</span></div>
        </section>

        <div className="workspace">
          <section className="workspace-heading">
            <div><div className="section-kicker">THE TRIP DESK <span>01 / 03</span></div><h2>A plan with <i>purpose.</i></h2></div>
            <div className="model-status" aria-live="polite">
              <span className={`health-icon ${health.isError ? 'health-error' : ''}`}><HeartPulse size={16} /></span>
              <span><b>{health.isLoading ? 'Connecting to planner' : health.isError ? 'Planner connection issue' : health.data?.groqConfigured ? 'Groq Llama planning' : 'Groq key not configured'}</b><small>{health.data ? `${health.data.groqConfigured ? 'Server ready' : 'Add GROQ_API_KEY in .env'} · ${health.data.model} · ${health.data.mode.replace('_', ' ')}` : health.isError ? errorMessage(health.error) : 'Server health and model status'}</small></span>
            </div>
          </section>

          <section id="planner" className="planner-layout">
            <form className="planner-card" onSubmit={submitTrip}>
              <div className="card-heading"><div><span className="tiny-index">01</span><h3>Start with the feeling.</h3></div><span className="form-caption">TRIP BRIEF</span></div>
              <div className="scenario-row">
                <div className="field-label">NEED A STARTING POINT?</div>
                {demos.isLoading ? <div className="skeleton-line" aria-label="Loading sample trips" /> : demos.isError ? <div className="inline-error">{errorMessage(demos.error)}</div> : (
                  <select aria-label="Fill from a sample trip" data-testid="select-demo-scenario" defaultValue="" onChange={(event) => selectScenario(event.target.value)}>
                    <option value="">Fill with a sample trip…</option>
                    {(demos.data ?? []).map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.title} — {scenario.description}</option>)}
                  </select>
                )}
              </div>
              <div className="form-grid">
                <label className="field span-two"><span>DESTINATION</span><div className="input-with-icon"><MapPin size={16} /><select required value={draft.destinationId} onChange={(e) => updateDraft('destinationId', e.target.value)} data-testid="select-destination"><option value="">Choose a place</option>{(destinations.data ?? []).map((destination) => <option key={destination.id} value={destination.id}>{destination.name}, {destination.country}</option>)}</select><ChevronDown size={15} /></div></label>
                <label className="field"><span>STARTING FROM <small>OPTIONAL</small></span><input placeholder="City or airport" value={draft.origin} onChange={(e) => updateDraft('origin', e.target.value)} data-testid="input-origin" /></label>
                <label className="field"><span>TRAVELERS</span><div className="input-with-icon"><Users size={15} /><input type="number" min="1" max="12" value={draft.travelers} onChange={(e) => updateDraft('travelers', e.target.value)} data-testid="input-travelers" /></div></label>
                <label className="field"><span>DEPART</span><div className="input-with-icon"><CalendarDays size={15} /><input required type="date" value={draft.startDate} onChange={(e) => updateDraft('startDate', e.target.value)} data-testid="input-start-date" /></div></label>
                <label className="field"><span>RETURN</span><div className="input-with-icon"><CalendarDays size={15} /><input required type="date" value={draft.endDate} onChange={(e) => updateDraft('endDate', e.target.value)} data-testid="input-end-date" /></div></label>
                <label className="field"><span>TOTAL BUDGET <small>INR</small></span><div className="input-with-icon"><Wallet size={15} /><input type="number" min="1000" step="1000" value={draft.budgetInr} onChange={(e) => updateDraft('budgetInr', e.target.value)} data-testid="input-budget" /></div></label>
                <label className="field"><span>PACE</span><select value={draft.pace} onChange={(e) => updateDraft('pace', e.target.value)} data-testid="select-pace"><option value="relaxed">Slow & unhurried</option><option value="balanced">A little of everything</option><option value="packed">Make every day count</option></select></label>
                <label className="field span-two"><span>WHAT DRAWS YOU IN? <small>COMMA SEPARATED</small></span><input value={draft.interests} onChange={(e) => updateDraft('interests', e.target.value)} placeholder="Food, design, the outdoors…" data-testid="input-interests" /></label>
                <label className="field span-two"><span>ACTIVITIES YOU ENJOY <small>COMMA SEPARATED</small></span><input value={draft.activityPreferences} onChange={(e) => updateDraft('activityPreferences', e.target.value)} placeholder="Walking, museums, cooking…" data-testid="input-activities" /></label>
                <label className="field span-two"><span>ANYTHING ELSE? <small>OPTIONAL</small></span><textarea rows={2} maxLength={500} value={draft.notes} onChange={(e) => updateDraft('notes', e.target.value)} placeholder="A birthday dinner, an early start, one day with no plans…" data-testid="input-notes" /></label>
              </div>
              {destinations.isError && <div className="notice notice-error" role="alert"><CircleAlert size={16} /> Destinations could not load. {errorMessage(destinations.error)} <button type="button" onClick={() => destinations.refetch()}>Retry</button></div>}
              {formError && <div className="notice notice-error" role="alert"><CircleAlert size={16} /><span>{formProviderThrottled && <><b>The planning provider is temporarily throttling requests.</b> Wait a moment before trying again. </>}{formError}</span></div>}
              <button className="submit-button" type="submit" disabled={isPlanning || destinations.isLoading} data-testid="button-plan-trip">
                {isPlanning ? <><span className="button-pulse" /> Your crew is planning…</> : <>Set the agents in motion <ArrowRight size={17} /></>}
              </button>
              <p className="privacy-note"><Sparkles size={12} aria-hidden="true" /> Your plan is generated by Groq on our server. No provider calls are made from your browser.</p>
            </form>
            <aside className="side-column">
              <div className="side-card destination-card">
                <span className="side-overline">A LITTLE INSPIRATION</span>
                <h3>Places worth<br />taking the <i>long way.</i></h3>
                {destinations.isLoading ? <div className="skeleton-stack"><div /><div /><div /></div> : destinations.data?.length ? <div className="destination-list">{destinations.data.slice(0, 4).map((destination, i) => <button key={destination.id} className="destination-choice" onClick={() => updateDraft('destinationId', destination.id)} data-testid={`button-destination-${destination.id}`}><span className={`destination-number number-${i}`}>0{i + 1}</span><span><b>{destination.name}</b><small>{destination.region}, {destination.country}</small></span><ArrowRight size={15} /></button>)}</div> : destinations.isError ? <p className="subtle-copy">Supported places are temporarily unavailable.</p> : <p className="subtle-copy">Destination suggestions will appear here.</p>}
                {destinations.data?.[0] && <p className="destination-footnote">{destinations.data[0].description}</p>}
              </div>
              <div className="side-card crew-teaser" id="agents">
                <div className="crew-teaser-top"><span className="side-overline">YOUR PLANNING CREW</span><span className="crew-count">{agents.data?.length ?? '—'} / 05</span></div>
                {agents.isLoading ? <div className="skeleton-stack"><div /><div /><div /></div> : agents.isError ? <div className="inline-error">{errorMessage(agents.error)} <button onClick={() => agents.refetch()}>Retry</button></div> : (agents.data ?? []).map((agent, i) => <div className="agent-row" key={agent.id}><span className={`agent-avatar agent-${i}`}>{['01', '02', '03', '04', '05'][i] ?? '05'}</span><span><b>{agent.name}</b><small>{agent.responsibility}</small></span></div>)}
              </div>
            </aside>
          </section>

          {planningError && <section className="run-error" role="alert"><CircleAlert size={18} /><div><b>{providerThrottled ? 'The planning provider is temporarily throttling requests.' : "We couldn't complete this run."}</b><p>{planningError}</p><span>{providerThrottled ? 'Wait a moment before trying again. The run has not completed.' : 'Planning failures include a category code so you can distinguish setup, provider and validation issues.'}</span></div><button onClick={() => { if (lastRequest) startPlanning(lastRequest); }} disabled={!lastRequest || isPlanning}><RotateCcw size={15} /> Try again</button></section>}

          {isPlanning && <section className="pending-panel" aria-live="polite"><div className="pending-mark"><Sparkles size={20} /></div><div><span className="section-kicker">THE CREW IS AT WORK</span><h3>Bringing the details together.</h3><p>Destination research, routing, budget, weather and a final critic pass.</p></div><div className="pending-steps"><i /><i /><i /><i /><i /></div></section>}

          {result && <section className="results-area" aria-live="polite">
            <div className="result-header">
              <div><div className="section-kicker">YOUR TRIP BLUEPRINT <span>RUN {result.runId.slice(0, 8).toUpperCase()}</span></div><h2>{destinations.data?.find((d) => d.id === result.request.destinationId)?.name ?? 'Your next destination'} <i>awaits.</i></h2><p>{dateLabel(result.request.startDate)} — {dateLabel(result.request.endDate)} <span>·</span> {result.request.travelers} travelers <span>·</span> {result.request.pace} pace</p></div>
               <div className="result-badges"><span className={`status-badge status-${result.status}`}>{result.status.replace('_', ' ')}</span><span className="model-badge">{offlinePlan ? <CircleAlert size={13} /> : <Sparkles size={13} />}{offlinePlan ? ' Offline demo plan' : ` Groq · ${result.model}`}</span></div>
            </div>
             {offlinePlan && <div className="offline-plan-banner" role="status" data-testid="offline-plan-banner"><CircleAlert size={18} /><div><b>Offline fallback plan</b><p>{result.fallbackNotice ?? 'This itinerary uses bundled local data only; it has no AI review, live prices, availability checks, or live forecast.'}</p></div></div>}
            <div className="summary-strip">
              <div><span>ESTIMATED TOTAL</span><b>{money(result.budgetAssessment.totalEstimatedInr)}</b><small className={result.budgetAssessment.withinBudget ? 'positive' : 'negative'}>{money(Math.abs(result.budgetAssessment.remainingInr))} {result.budgetAssessment.remainingInr >= 0 ? 'left in budget' : 'over budget'}</small></div>
              <div><span>TRIP LENGTH</span><b>{result.itinerary.length} <small>days</small></b><small>{result.itinerary.reduce((sum, day) => sum + day.activities.length, 0)} planned moments</small></div>
               <div><span>CRITIC REVIEW</span><b>{offlinePlan ? 'Not run' : result.criticReports.some((r) => r.decision === 'APPROVED') ? 'Reviewed' : 'Needs a look'}</b><small>{offlinePlan ? 'No live AI critic review' : `${result.revisionCount} ${result.revisionCount === 1 ? 'revision' : 'revisions'} · ${result.criticReports.reduce((sum, report) => sum + report.issues.length, 0)} notes`}</small></div>
                <div><span>{offlinePlan ? 'PLANNING MODE' : 'PLANNING CREW'}</span><b>{offlinePlan ? 'Offline' : <>{result.agentsUsed.length || 5} <small>agents</small></>}</b><small>{offlinePlan ? 'Bundled local data · no AI agents' : 'Powered by Groq API'}</small></div>
            </div>

            <div className="result-grid">
              <section className="result-card itinerary-card">
                <div className="result-card-head"><div><span className="section-kicker">THE DAY-BY-DAY</span><h3>Made for the moment.</h3></div><span className="itinerary-total">{result.itinerary.length} DAYS</span></div>
                {result.itinerary.length ? result.itinerary.map((day) => <article className="day-block" key={`${day.dayNumber}-${day.date}`}><div className="day-marker"><span>DAY</span><b>{String(day.dayNumber).padStart(2, '0')}</b></div><div className="day-content"><div className="day-title"><div><span>{dateLabel(day.date)}</span><h4>{day.theme}</h4></div><span className="route-distance">{day.routeDistanceKm} km straight-line</span></div>
                  {day.activities.map((activity, index) => <div className="activity-item" key={`${activity.placeId}-${index}`}><div className="activity-time">{activity.startTime}</div><div className="activity-dot" /><div className="activity-detail"><div><b>{activity.name}</b><span className="activity-category">{activity.category}</span></div><p>{activity.rationale}</p><small>{activity.area} · {activity.durationMinutes} min · {money(activity.estimatedCostInr)} / traveler</small></div><span className={`setting-tag setting-${activity.setting}`}>{activity.setting}</span></div>)}
                </div></article>) : <div className="empty-state"><Compass size={24} /><b>No itinerary days returned</b><span>The run completed without day-by-day suggestions.</span></div>}
              </section>
              <div className="assessment-column">
                <section className="result-card budget-card"><div className="result-card-head"><div><span className="section-kicker">THE NUMBERS</span><h3>Budget outlook</h3></div><Wallet size={19} /></div><div className="budget-total"><b>{money(result.budgetAssessment.totalEstimatedInr)}</b><span>of {money(result.budgetAssessment.budgetInr)}</span></div><div className="budget-meter"><span style={{ width: `${Math.min(100, Math.max(3, result.budgetAssessment.totalEstimatedInr / result.budgetAssessment.budgetInr * 100))}%` }} /></div><div className="budget-lines">{[['Stay', result.budgetAssessment.accommodationInr], ['Food', result.budgetAssessment.foodInr], ['Activities', result.budgetAssessment.activitiesInr], ['Getting around', result.budgetAssessment.transportInr], ['Just in case', result.budgetAssessment.contingencyInr]].map(([label, value]) => <div key={label}><span>{label}</span><b>{money(Number(value))}</b></div>)}</div><div className={`budget-verdict ${result.budgetAssessment.withinBudget ? '' : 'verdict-over'}`}><span>{result.budgetAssessment.withinBudget ? <Check size={14} /> : <CircleAlert size={14} />}</span>{result.budgetAssessment.explanation}</div></section>
                <section className="result-card weather-card"><div className="result-card-head"><div><span className="section-kicker">TYPICAL CLIMATE · NOT A FORECAST</span><h3>Seasonal notes</h3></div><Sun size={20} /></div>{result.weatherAssessment.length ? result.weatherAssessment.map((weather) => <div className="weather-row" key={weather.date}><div className="weather-date">{dateLabel(weather.date)}</div><div className="weather-info"><b>{weather.summary}</b><span>{weather.minTempC}° – {weather.maxTempC}°C <i>·</i> {weather.rainChancePercent}% typical monthly rain chance</span><p>{weather.recommendation}</p>{weather.affectedActivities.length > 0 && <small>Keep an eye on: {weather.affectedActivities.join(', ')}</small>}</div></div>) : <p className="subtle-copy">No seasonal notes were returned.</p>}</section>
              </div>
            </div>

            <section className="result-card critic-card"><div className="result-card-head"><div><span className="section-kicker">THE FINAL PASS</span><h3>Critic's notes</h3></div><BadgeCheck size={20} /></div><div className="critic-summary">{result.criticReports.map((report, index) => <div key={`${report.decision}-${index}`} className="critic-report"><div className="critic-verdict"><span className={report.decision === 'APPROVED' ? 'approved-icon' : 'review-icon'}>{report.decision === 'APPROVED' ? <Check size={14} /> : <CircleAlert size={14} />}</span><b>{report.decision === 'APPROVED' ? 'Approved for takeoff' : 'Needs attention'}</b></div><p>{report.approvalSummary}</p>{report.issues.map((issue) => <div className="issue-row" key={issue.id}><span className={`severity severity-${issue.severity}`}>{issue.severity}</span><div><b>{issue.responsibleAgent} · {issue.requestedAction}</b><p>{issue.evidence}</p></div></div>)}</div>)}{!result.criticReports.length && <p className="subtle-copy">No critic report was included in this run.</p>}</div></section>

            <section className="result-card messages-card"><div className="result-card-head"><div><span className="section-kicker">BEHIND THE PLAN</span><h3>Agent correspondence</h3></div><span className="message-count"><MessageSquareText size={14} /> {result.messages.length} messages</span></div>{result.messages.length ? <div className="message-list">{result.messages.map((message) => <article className="message-item" key={message.id}><div className="message-meta"><span className="sender-mark">{message.sender.slice(0, 2).toUpperCase()}</span><span><b>{message.sender}</b><small>to {message.recipient} · {message.type}</small></span><time>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><span className={`message-status message-${message.status.toLowerCase()}`}>{message.status}</span></div><p className="message-task">{message.task}</p>{message.result && <blockquote>{message.result}</blockquote>}</article>)}</div> : <div className="empty-state"><MessageSquareText size={22} /><b>No agent messages returned</b><span>Messages will appear here when available from the run.</span></div>}</section>
            <section className="result-card trace-card" id="trace"><div className="trace-heading"><div className="result-card-head"><div><span className="section-kicker">A CLEAR RECORD</span><h3>Execution trace</h3></div><span className="trace-count">{traceEvents.length} events</span></div><div className="trace-actions"><button onClick={() => setShowTrace(!showTrace)} aria-expanded={showTrace}>{showTrace ? 'Hide events' : 'Show events'} <ChevronDown size={15} /></button><button onClick={exportTrace} disabled={!traceEvents.length} data-testid="button-export-trace"><FileJson2 size={14} /> Export JSON</button></div></div>
              {showTrace && <div className="trace-content">{trace.isLoading && !traceEvents.length && <div className="skeleton-stack"><div /><div /><div /></div>}{trace.isError && !traceEvents.length && <div className="notice notice-error" role="alert"><CircleAlert size={15} />{errorMessage(trace.error)} <button onClick={() => trace.refetch()}>Retry</button></div>}{Boolean(traceEvents.length || (!trace.isLoading && !trace.isError)) && <><div className="trace-tools"><label className="trace-search"><Search size={15} /><input type="search" placeholder="Search events, agents, tools…" value={traceSearch} onChange={(e) => setTraceSearch(e.target.value)} aria-label="Search execution trace" data-testid="input-trace-search" /></label><select aria-label="Filter trace events" value={traceFilter} onChange={(e) => setTraceFilter(e.target.value)} data-testid="select-trace-filter"><option value="all">All event types</option><option value="success">Successful</option><option value="completed">Completed</option><option value="error">Errors</option><option value="tool_call">Tool calls</option></select></div>{filteredEvents.length ? <div className="trace-list">{filteredEvents.map((item) => <TraceRow key={item.eventId} item={item} />)}</div> : <div className="empty-state compact"><Activity size={20} /><b>{traceEvents.length ? 'No matching events' : 'No trace events'}</b><span>{traceEvents.length ? 'Try another search or filter.' : 'This run did not include execution events.'}</span></div>}</>}</div>}
            </section>
          </section>}
          {!result && !isPlanning && !planningError && <section className="before-run"><Sparkles className="before-ornament" size={19} aria-hidden="true" /><div><b>Good plans start with the little things.</b><p>Fill the brief or pick a sample trip. Your five-agent crew will take it from there.</p></div><button onClick={() => jumpTo('planner')}>Start planning <ArrowRight size={15} /></button></section>}
          <footer className="page-footer"><a href="#top" className="footer-brand"><Compass size={17} /> tripnexus</a><span>Thoughtful trips, assembled together.</span><button onClick={downloadDocumentation} disabled={documentation.isFetching}>Project documentation <ArrowDownToLine size={14} /></button></footer>
          {documentation.isError && <div className="toast-error" role="alert">Documentation download failed: {errorMessage(documentation.error)} <button onClick={downloadDocumentation}>Retry</button></div>}
        </div>
      </main>
    </div>
  );
}

function TraceRow({ item }: { item: TraceEvent }) {
  return <article className="trace-event"><span className="event-sequence">{String(item.sequence).padStart(2, '0')}</span><span className={`event-type-dot event-${item.status.toLowerCase()}`} /><div className="event-body"><div className="event-title"><b>{item.summary}</b><span>{item.eventType.replaceAll('_', ' ')}</span></div><div className="event-meta">{item.agentId}{item.fromAgent && ` · ${item.fromAgent} → ${item.toAgent}`} {item.toolName && ` · ${item.toolName}`} {item.revisionNumber > 0 && ` · revision ${item.revisionNumber}`}</div>{item.action && <p>{item.action}</p>}</div><time>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></article>;
}

function Router() {
  return <RoutedErrorBoundary><Switch><Route path="/" component={AppWorkspace} /><Route component={NotFound} /></Switch></RoutedErrorBoundary>;
}
function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
