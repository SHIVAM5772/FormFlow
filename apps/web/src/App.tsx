'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useParams, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  FileSpreadsheet,
  Files,
  History,
  LayoutDashboard,
  Link2,
  Loader2,
  LogOut,
  Menu,
  Moon,
  Pause,
  Play,
  Plus,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
  UploadCloud,
  X,
  XCircle,
  AlertTriangle,
  BarChart3,
  Workflow,
} from 'lucide-react';
import {
  restrictionMessage,
  safeToRetry,
  type FormDefinition,
} from '../../../packages/shared/src/index';
import { api, get, download, errorMessage } from './api';

type StoredForm = {
  id: string;
  title: string;
  sourceUrl: string;
  createdAt: string;
  schemas: { version: number; definition: FormDefinition }[];
};
type Job = {
  id: string;
  title: string;
  status: string;
  reason?: string;
  createdAt: string;
  counts?: Record<string, number>;
  _count?: { records: number };
};
const ToastContext = createContext<(message: string) => void>(() => {});
const useToast = () => useContext(ToastContext);
function Loading() {
  return (
    <div aria-label="Loading" className="space-y-4 animate-pulse">
      <div className="skeleton h-24" />
      <div className="skeleton h-56" />
    </div>
  );
}
function ErrorBox({ error }: { error: unknown }) {
  return (
    <div role="alert" className="notice error">
      <AlertTriangle size={18} />
      <span>{errorMessage(error)}</span>
    </div>
  );
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <Files size={36} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Status({ value }: { value: string }) {
  return (
    <span className={`status ${value.toLowerCase()}`}>
      <span />
      {value.replaceAll('_', ' ')}
    </span>
  );
}
function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
function DownloadButton({
  path,
  name,
  label = 'Download report',
}: {
  path: string;
  name: string;
  label?: string;
}) {
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => download(path, name),
    onError: (e) => toast(errorMessage(e)),
  });
  return (
    <button className="btn secondary" disabled={m.isPending} onClick={() => m.mutate()}>
      <ArrowDownToLine size={16} />
      {m.isPending ? 'Preparing…' : label}
    </button>
  );
}
const nav = [
  ['/', 'Dashboard', LayoutDashboard],
  ['/analyze', 'Analyze Form', Search],
  ['/forms', 'My Forms', Files],
  ['/templates', 'Excel Templates', FileSpreadsheet],
  ['/upload', 'Upload Responses', UploadCloud],
  ['/jobs', 'Submission Jobs', Activity],
  ['/history', 'Submission History', History],
  ['/reports', 'Reports', BarChart3],
  ['/settings', 'Settings', SettingsIcon],
] as const;

export function FormFlowShell({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState('');
  const [dark, setDark] = useState(false);
  const [themeReady, setThemeReady] = useState(false);
  useEffect(() => {
    setDark(localStorage.getItem('theme') === 'dark');
    setThemeReady(true);
  }, []);
  const [menu, setMenu] = useState(false);
  const client = useQueryClient();
  const pathname = usePathname();
  const router = useRouter();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => get<{ id: string; email: string }>('/auth/me'),
    retry: false,
  });
  useEffect(() => {
    if (me.data && pathname === '/signup') router.replace('/');
  }, [me.data, pathname, router]);
  useEffect(() => {
    if (!themeReady) return;
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark, themeReady]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    setMenu(false);
  }, [pathname]);
  if (me.isPending)
    return (
      <div className="boot">
        <Loader2 className="animate-spin" />
        Opening FormFlow…
      </div>
    );
  return (
    <ToastContext.Provider value={setToast}>
      {!me.data ? (
        <Login key={pathname === '/signup' ? 'signup' : 'login'} signup={pathname === '/signup'} />
      ) : (
        <div className="app-shell">
          {menu && (
            <button
              aria-label="Close navigation"
              className="scrim"
              onClick={() => setMenu(false)}
            />
          )}
          <aside className={menu ? 'sidebar open' : 'sidebar'}>
            <Link href="/" className="brand">
              <span className="brand-icon">
                <Workflow size={23} />
              </span>
              <span>
                FormFlow<span className="brand-sub">AUTOMATION</span>
              </span>
            </Link>
            <div className="workspace-label">YOUR WORKSPACE</div>
            <nav aria-label="Main navigation">
              {nav.map(([to, label, Icon]) => (
                <Link
                  key={to}
                  href={to}
                  className={
                    pathname === to || (to !== '/' && pathname.startsWith(to + '/'))
                      ? 'active'
                      : undefined
                  }
                  aria-current={pathname === to ? 'page' : undefined}
                >
                  <Icon size={18} />
                  {label}
                  <ChevronRight size={14} className="nav-chevron" />
                </Link>
              ))}
            </nav>
            <div className="sidebar-note">
              <ShieldCheck size={21} />
              <strong>Built for responsible workflows</strong>
              <p>Review every batch. Submit with authorization. Verify every response.</p>
            </div>
            <div className="profile">
              <span className="avatar">{me.data.email[0].toUpperCase()}</span>
              <span className="profile-email">{me.data.email}</span>
              <button
                title="Sign out"
                aria-label="Sign out"
                onClick={() =>
                  void api
                    .post('/auth/logout')
                    .then(() => {
                      client.clear();
                      window.location.reload();
                    })
                    .catch((e) => setToast(errorMessage(e)))
                }
              >
                <LogOut size={17} />
              </button>
            </div>
          </aside>
          <div className="main-column">
            <header className="topbar">
              <button
                className="mobile-menu"
                aria-label="Open navigation"
                onClick={() => setMenu(true)}
              >
                <Menu size={22} />
              </button>
              <span className="breadcrumb">
                Workspace <ChevronRight size={14} />{' '}
                <strong>
                  {nav.find(([path]) => path === pathname)?.[1] ?? 'Submission details'}
                </strong>
              </span>
              <div className="topbar-right">
                <span className="workspace-badge">
                  <span />
                  Private workspace
                </span>
                <button
                  aria-label={dark ? 'Use light mode' : 'Use dark mode'}
                  onClick={() => setDark(!dark)}
                >
                  {dark ? <Sun size={19} /> : <Moon size={19} />}
                </button>
              </div>
            </header>
            <main>{children}</main>
            <footer>
              FormFlow Automation <span>Every row, accounted for.</span>
            </footer>
          </div>
        </div>
      )}
      {toast && (
        <div role="status" className="toast">
          <span>{toast}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
    </ToastContext.Provider>
  );
}
function Login({ signup = false }: { signup?: boolean }) {
  const client = useQueryClient();
  const schema = z
    .object({
      email: z.string().trim().email('Enter your email address').max(191),
      password: signup
        ? z
            .string()
            .min(12, 'Use at least 12 characters')
            .max(72, 'Use a shorter password')
            .refine(
              (value) => new TextEncoder().encode(value).length <= 72,
              'Use a shorter password (maximum 72 UTF-8 bytes)',
            )
        : z.string().min(1, 'Enter your password'),
      confirmPassword: z.string().optional(),
    })
    .refine((value) => !signup || value.password === value.confirmPassword, {
      message: 'Passwords do not match',
      path: ['confirmPassword'],
    });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const mutation = useMutation({
    mutationFn: ({ email, password }: z.infer<typeof schema>) =>
      api.post(signup ? '/auth/signup' : '/auth/login', { email, password }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['me'] }),
  });
  return (
    <div className="login-shell">
      <div className="login-story">
        <span className="brand">
          <span className="brand-icon">
            <Workflow />
          </span>
          FormFlow
        </span>
        <div>
          <div className="eyebrow">LESS REPETITION. MORE FLOW.</div>
          <h1>
            From spreadsheet
            <br />
            to submitted.
          </h1>
          <p>
            Turn form responses into a clear, reviewable workflow. One template. Every record. Full
            visibility.
          </p>
          <div className="login-steps">
            <FileSpreadsheet />
            <ArrowRight />
            <Workflow />
            <ArrowRight />
            <CheckCircle2 />
          </div>
        </div>
        <small>Authorized submissions · Verified outcomes</small>
      </div>
      <div className="login-panel">
        <div className="login-card">
          <div className="eyebrow">YOUR WORKSPACE</div>
          <h1>{signup ? 'Create your account' : 'Welcome back'}</h1>
          <p>
            {signup
              ? 'Start your own workspace for form workflows.'
              : 'Sign in to manage your form workflows.'}
          </p>
          <form onSubmit={form.handleSubmit((body) => mutation.mutate(body))}>
            <label htmlFor="email">Email address</label>
            <input id="email" type="email" autoComplete="username" {...form.register('email')} />
            {form.formState.errors.email && (
              <p className="field-error">{form.formState.errors.email.message}</p>
            )}
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={signup ? 'new-password' : 'current-password'}
              aria-describedby={signup ? 'password-help' : undefined}
              {...form.register('password')}
            />
            {form.formState.errors.password && (
              <p className="field-error">{form.formState.errors.password.message}</p>
            )}
            {signup && (
              <>
                <p id="password-help" className="auth-hint">
                  Use at least 12 characters.
                </p>
                <label htmlFor="confirm-password">Confirm password</label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  {...form.register('confirmPassword')}
                />
                {form.formState.errors.confirmPassword && (
                  <p className="field-error" role="alert">
                    {form.formState.errors.confirmPassword.message}
                  </p>
                )}
              </>
            )}
            {mutation.isError && <ErrorBox error={mutation.error} />}
            <button className="btn" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <ArrowRight size={18} />
              )}
              {mutation.isPending
                ? signup
                  ? 'Creating account…'
                  : 'Signing in…'
                : signup
                  ? 'Create account'
                  : 'Sign in'}
            </button>
          </form>
          <p className="small-note">{signup ? 'Already have an account?' : 'New to FormFlow?'}</p>
          <Link className="btn secondary auth-switch" href={signup ? '/' : '/signup'}>
            {signup ? 'Sign in' : 'Sign up'}
          </Link>
        </div>
      </div>
    </div>
  );
}
export function Dashboard() {
  const stats = useQuery({
    queryKey: ['stats'],
    queryFn: () => get('/dashboard/stats'),
    refetchInterval: 15000,
  });
  const jobs = useQuery({
    queryKey: ['jobs'],
    queryFn: () => get<Job[]>('/submissions'),
    refetchInterval: 10000,
  });
  return (
    <>
      <PageTitle
        eyebrow="WORKSPACE OVERVIEW"
        title="Keep your responses flowing."
        description="Your forms, spreadsheets, and submissions — connected in one place."
        action={
          <Link className="btn" href="/analyze">
            <Plus size={17} />
            Analyze a form
          </Link>
        }
      />
      <section className="welcome-banner">
        <div>
          <span className="banner-tag">YOUR NEXT WORKFLOW STARTS HERE</span>
          <h2>
            One spreadsheet.
            <br />
            Hundreds of possibilities.
          </h2>
          <p>
            Analyze a Google Form, fill your Excel template,
            <br className="desktop-break" /> and review your responses before they go.
          </p>
          <Link href="/analyze" className="banner-link">
            Create your first workflow <ArrowRight size={17} />
          </Link>
        </div>
        <div className="flow-art" aria-hidden="true">
          <div className="art-card art-sheet">
            <FileSpreadsheet size={33} />
            <i />
            <i />
            <i />
          </div>
          <div className="art-connector">
            ······
            <ArrowRight size={23} />
            ······
          </div>
          <div className="art-card art-form">
            <Workflow size={33} />
            <i />
            <i />
            <span>
              <Check size={15} />
              Verified
            </span>
          </div>
          <span className="art-dot dot-one" />
          <span className="art-dot dot-two" />
        </div>
      </section>
      {stats.isPending ? (
        <Loading />
      ) : stats.isError ? (
        <ErrorBox error={stats.error} />
      ) : (
        <div className="stats-grid">
          {[
            [Files, 'Forms analyzed', stats.data.forms, 'Your connected forms'],
            [ClipboardList, 'Records processed', stats.data.processed, 'Completed processing'],
            [CheckCircle2, 'Successful submissions', stats.data.submitted, 'Visibly confirmed'],
            [
              XCircle,
              'Failed submissions',
              stats.data.failed,
              `${stats.data.unknown} unverified records`,
            ],
            [Activity, 'Active jobs', stats.data.activeJobs, 'Queued, running or paused'],
          ].map(([Icon, label, value, note]: any) => (
            <div className="stat-card" key={label}>
              <span className="stat-icon">
                <Icon size={19} />
              </span>
              <span className="stat-label">{label}</span>
              <strong>{value.toLocaleString()}</strong>
              <small>{note}</small>
            </div>
          ))}
        </div>
      )}
      <div className="section-heading">
        <div>
          <h2>Recent submission jobs</h2>
          <p>A clear view of what’s moving and what needs attention.</p>
        </div>
        <Link href="/jobs">
          View all jobs <ArrowRight size={16} />
        </Link>
      </div>
      <div className="panel">
        {jobs.isPending ? (
          <Loading />
        ) : jobs.isError ? (
          <ErrorBox error={jobs.error} />
        ) : jobs.data?.length ? (
          <JobTable jobs={jobs.data.slice(0, 5)} />
        ) : (
          <Empty title="A fresh start for your forms">
            Your first submission job will appear here.{' '}
            <Link href="/analyze">
              Analyze a form to get started <ArrowRight size={14} />
            </Link>
          </Empty>
        )}
      </div>
      <div className="section-heading">
        <div>
          <h2>A simpler way to submit</h2>
          <p>Four steps from form to finished.</p>
        </div>
        <span className="subtle">YOU STAY IN CONTROL</span>
      </div>
      <div className="steps-grid">
        {[
          [
            Search,
            '01',
            'Analyze your form',
            'Paste the Google Form link and review its questions.',
          ],
          [
            FileSpreadsheet,
            '02',
            'Fill your template',
            'Download a tailored Excel file and add your responses.',
          ],
          [
            ShieldCheck,
            '03',
            'Review and confirm',
            'Validate every row and authorize the submission batch.',
          ],
          [
            Activity,
            '04',
            'Follow the progress',
            'Track verified submissions and download your report.',
          ],
        ].map(([Icon, n, title, desc]: any) => (
          <div className="step-card" key={n}>
            <div>
              <Icon size={21} />
              <span>{n}</span>
            </div>
            <h3>{title}</h3>
            <p>{desc}</p>
          </div>
        ))}
      </div>
    </>
  );
}
export function Analyze() {
  const router = useRouter();
  const [owner, setOwner] = useState(false);
  const form = useForm<{ url: string }>({
    resolver: zodResolver(z.object({ url: z.string().url('Enter a full Google Forms URL') })),
  });
  const m = useMutation({
    mutationFn: async (body: { url: string }) =>
      (await api.post('/forms/analyze', { ...body, useGoogleApi: owner })).data.data,
    onSuccess: (saved: StoredForm) => router.push(`/forms/${saved.id}`),
  });
  return (
    <>
      <PageTitle
        eyebrow="CONNECT A FORM"
        title="Start with a Google Form."
        description="We’ll inspect the accessible questions and prepare your response template."
      />
      <div className="panel analyze-panel">
        <div className="panel-icon">
          <Link2 size={25} />
        </div>
        <h2>What form are we working with?</h2>
        <p>Use a respondent link from docs.google.com/forms or forms.gle.</p>
        <form onSubmit={form.handleSubmit((body) => m.mutate(body))}>
          <label htmlFor="form-url">Google Form URL</label>
          <div className="input-action">
            <input
              id="form-url"
              placeholder="https://docs.google.com/forms/d/e/…/viewform"
              {...form.register('url')}
            />
            <button className="btn" disabled={m.isPending}>
              {m.isPending ? <Loader2 size={17} className="animate-spin" /> : <Search size={17} />}
              Analyze form
            </button>
          </div>
          {form.formState.errors.url && (
            <p className="field-error">{form.formState.errors.url.message}</p>
          )}
          <label className="checkbox-label">
            <input type="checkbox" checked={owner} onChange={(e) => setOwner(e.target.checked)} />
            Analyze a form I own using my connected Google account
          </label>
        </form>
        {m.isPending && (
          <div className="notice">
            <Loader2 className="animate-spin" size={18} />
            Inspecting the form. This can take up to 30 seconds.
          </div>
        )}
        {m.isError && <ErrorBox error={m.error} />}
      </div>
      <div className="notice">
        <ShieldCheck size={20} />
        <div>
          <strong>Access is always respected.</strong>
          <p>
            Sign-in restrictions, file uploads, CAPTCHA, and unsupported questions are flagged for
            manual handling. Connect Google in Settings for owner API analysis; no Google password
            is requested.
          </p>
        </div>
      </div>
    </>
  );
}
export function Forms() {
  const forms = useQuery({ queryKey: ['forms'], queryFn: () => get<StoredForm[]>('/forms') });
  return (
    <>
      <PageTitle
        title="My Forms"
        description="Your analyzed forms and their latest question mappings."
        action={
          <Link className="btn" href="/analyze">
            <Plus size={17} />
            Analyze form
          </Link>
        }
      />
      {forms.isPending ? (
        <Loading />
      ) : forms.isError ? (
        <ErrorBox error={forms.error} />
      ) : (
        <div className="form-grid">
          {forms.data.map((form) => (
            <Link className="panel form-card" href={`/forms/${form.id}`} key={form.id}>
              <span className="panel-icon">
                <ClipboardList />
              </span>
              <h2>{form.title}</h2>
              <p>
                {form.schemas[0]?.definition.questions.length ?? 0} questions · Version{' '}
                {form.schemas[0]?.version}
              </p>
              <div className="form-card-footer">
                <span>{new Date(form.createdAt).toLocaleDateString()}</span>
                <ArrowRight size={18} />
              </div>
            </Link>
          ))}
          {!forms.data.length && (
            <div className="panel">
              <Empty title="No forms yet">
                Analyze a Google Form to create your first template.
              </Empty>
            </div>
          )}
        </div>
      )}
    </>
  );
}
export function FormDetail() {
  const { id } = useParams<{ id: string }>();
  const client = useQueryClient();
  const form = useQuery({
    queryKey: ['forms', id],
    queryFn: () => get<StoredForm>(`/forms/${id}`),
  });
  const toast = useToast();
  const router = useRouter();
  const reanalyze = useMutation({
    mutationFn: async () => {
      if (!form.data) throw new Error('Wait for the form to load.');
      return (await api.post('/forms/analyze', { url: form.data.sourceUrl, useGoogleApi: false }))
        .data.data as StoredForm;
    },
    onSuccess: (saved) => {
      client.setQueryData(['forms', id], saved);
      void client.invalidateQueries({ queryKey: ['forms'], exact: true });
      toast('Form analysis refreshed. Review the latest questions and access requirements.');
    },
    onError: (error) => toast(errorMessage(error)),
  });
  const m = useMutation({
    mutationFn: () => download(`/forms/${id}/template`, 'formflow-template.xlsx'),
    onSuccess: (templateId) => {
      toast('Template downloaded. Fill it and upload it when ready.');
      router.push(`/upload?template=${templateId}`);
    },
    onError: (e) => toast(errorMessage(e)),
  });
  if (form.isPending) return <Loading />;
  if (form.isError) return <ErrorBox error={form.error} />;
  const definition = form.data.schemas[0].definition;
  return (
    <>
      <PageTitle
        eyebrow={`FORM SCHEMA · VERSION ${form.data.schemas[0].version}`}
        title={form.data.title}
        description={definition.description}
        action={
          <div className="flex flex-wrap gap-2">
            {definition.source === 'PUBLIC' && (
              <button
                className="btn secondary"
                disabled={reanalyze.isPending || m.isPending}
                onClick={() => reanalyze.mutate()}
              >
                {reanalyze.isPending ? (
                  <Loader2 size={17} className="animate-spin" />
                ) : (
                  <Search size={17} />
                )}
                {reanalyze.isPending ? 'Analyzing…' : 'Reanalyze form'}
              </button>
            )}
            <button
              className="btn"
              disabled={m.isPending || reanalyze.isPending || !definition.questions.length}
              onClick={() => m.mutate()}
            >
              <ArrowDownToLine size={17} />
              {m.isPending ? 'Preparing…' : 'Download Excel template'}
            </button>
          </div>
        }
      />
      <div className="form-meta">
        <span>
          <ClipboardList size={16} />
          {definition.questions.length} questions
        </span>
        <span>
          <Files size={16} />
          {definition.sections.length} sections
        </span>
        <span>
          <ShieldCheck size={16} />
          {definition.source === 'GOOGLE_API' ? 'Owner API' : 'Public respondent'} analysis
        </span>
        <a href={definition.sourceUrl} target="_blank" rel="noreferrer">
          Open original form ↗
        </a>
      </div>
      {definition.blockers.length > 0 && (
        <div className="notice error">
          <AlertTriangle size={20} />
          <div>
            <strong>Manual action required — automated submission is blocked.</strong>
            {definition.blockers.map((w, i) => (
              <p key={i}>{restrictionMessage(w)}</p>
            ))}
            {definition.capabilities.loginRequired && (
              <p>
                FormFlow login and Google respondent access are separate. If you own this form,
                review its sign-in, one-response and email-collection settings in Google Forms, then
                reanalyze. Otherwise ask the form owner about access.
              </p>
            )}
          </div>
        </div>
      )}
      {definition.warnings.length > 0 && (
        <div className="notice">
          <ShieldCheck size={20} />
          <div>
            {definition.warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        </div>
      )}
      <div className="section-heading">
        <h2>Detected questions</h2>
        <span className="subtle">REVIEW BEFORE GENERATING RESPONSES</span>
      </div>
      <div className="panel question-list">
        {!definition.questions.length && (
          <Empty title="Question preview unavailable">
            Google has not made usable question metadata available to this analysis. Resolve form
            access and reanalyze to generate a template.
          </Empty>
        )}
        {definition.questions.map((q, i) => (
          <div className="question" key={q.id}>
            <span className="question-number">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <h3>
                {q.title} {q.required && <b className="required">*</b>}
              </h3>
              <span className="subtle">
                {q.type.replaceAll('_', ' ')} · {q.required ? 'Required' : 'Optional'} ·{' '}
                {definition.sections.find((s) => s.id === q.sectionId)?.title}
              </span>
              {q.options.length > 0 && (
                <div className="option-list">
                  {q.options.map((o) => (
                    <span key={o}>{o}</span>
                  ))}
                </div>
              )}
              {q.rows.length > 0 && <p className="muted">Rows: {q.rows.join(', ')}</p>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
export function Templates() {
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => get<any[]>('/templates') });
  return (
    <>
      <PageTitle
        title="Excel Templates"
        description="Templates stay tied to the schema version used to generate them."
        action={
          <Link href="/forms" className="btn">
            <Plus size={16} />
            Generate a template
          </Link>
        }
      />
      <div className="panel">
        {templates.isPending ? (
          <Loading />
        ) : templates.isError ? (
          <ErrorBox error={templates.error} />
        ) : !templates.data.length ? (
          <Empty title="No templates yet">
            Open an analyzed form to download a tailored workbook.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Form</th>
                  <th>Version</th>
                  <th>Generated</th>
                  <th>Template ID</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {templates.data.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <strong>{t.schema.form.title}</strong>
                    </td>
                    <td>{t.schema.version}</td>
                    <td>{new Date(t.createdAt).toLocaleDateString()}</td>
                    <td className="mono">{t.id.slice(0, 8)}…</td>
                    <td>
                      <Link href={`/upload?template=${t.id}`}>
                        Upload responses <ArrowRight size={14} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
export function Upload() {
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => get<any[]>('/templates') });
  const searchParams = useSearchParams();
  const [template, setTemplate] = useState(searchParams.get('template') ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const toast = useToast();
  const validation = useMutation({
    mutationFn: async () => {
      if (!file || !template) throw new Error('Select a template and an XLSX file');
      const data = new FormData();
      data.append('templateId', template);
      data.append('file', file);
      return (await api.post('/uploads/validate', data)).data.data;
    },
  });
  const start = useMutation({
    mutationFn: async () =>
      (
        await api.post('/submissions/start', {
          uploadId: validation.data.id,
          authorized,
          confirmedValidRows: validation.data.valid,
        })
      ).data.data,
    onSuccess: (job: Job) => router.push(`/jobs/${job.id}`),
  });
  const formBlocked = (validation.data?.formBlockers?.length ?? 0) > 0;
  function choose(next: File | undefined) {
    if (next && !next.name.toLowerCase().endsWith('.xlsx')) {
      toast('Choose an XLSX file.');
      return;
    }
    setFile(next ?? null);
    setAuthorized(false);
    validation.reset();
    start.reset();
  }
  return (
    <>
      <PageTitle
        eyebrow="PREPARE A BATCH"
        title="Put your responses in motion."
        description="Upload your completed template. Every row is validated before submission."
      />
      <div className="panel upload-panel">
        <label htmlFor="template-select">Choose the template you filled</label>
        <select
          id="template-select"
          value={template}
          onChange={(e) => {
            setTemplate(e.target.value);
            validation.reset();
            setAuthorized(false);
          }}
        >
          <option value="">Select a generated template…</option>
          {templates.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.schema.form.title} · v{t.schema.version} · {t.id.slice(0, 8)}
            </option>
          ))}
        </select>
        {templates.isError && <ErrorBox error={templates.error} />}
        <div
          role="button"
          tabIndex={0}
          aria-label="Choose or drop an Excel file"
          className={`dropzone ${drag ? 'dragging' : ''}`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') input.current?.click();
          }}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            choose(e.dataTransfer.files[0]);
          }}
        >
          <span className="panel-icon">
            <UploadCloud size={28} />
          </span>
          <h3>{file ? file.name : 'Drop your completed Excel file here'}</h3>
          <p>
            {file
              ? `${(file.size / 1024).toFixed(0)} KB · Ready to validate`
              : 'or click to browse · XLSX only'}
          </p>
          <span className="subtle">KEEP THE ORIGINAL HEADINGS AND FIELD MAPPING</span>
        </div>
        <input
          ref={input}
          type="file"
          accept=".xlsx"
          className="sr-only"
          aria-label="Excel file"
          onChange={(e) => choose(e.target.files?.[0])}
        />
        <button
          className="btn"
          disabled={!file || !template || validation.isPending}
          onClick={() => validation.mutate()}
        >
          {validation.isPending ? (
            <Loader2 className="animate-spin" size={18} />
          ) : (
            <ShieldCheck size={18} />
          )}
          Validate responses
        </button>
        {validation.isError && <ErrorBox error={validation.error} />}
      </div>
      {validation.data && (
        <>
          <div className="section-heading">
            <div>
              <h2>Review your batch</h2>
              <p>Invalid and duplicate rows are excluded from submission.</p>
            </div>
            <DownloadButton
              path={`/uploads/${validation.data.id}/report`}
              name="validation-report.xlsx"
              label="Validation report"
            />
          </div>
          <div className="validation-summary">
            {[
              ['Total rows', validation.data.total],
              ['Valid rows', validation.data.valid],
              ['Invalid rows', validation.data.invalid],
            ].map(([label, value]) => (
              <div className="panel" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className="panel table-wrap validation-table">
            <table>
              <thead>
                <tr>
                  <th>Excel row</th>
                  <th>Status</th>
                  <th>Validation details</th>
                </tr>
              </thead>
              <tbody>
                {validation.data.rows.map((r: any) => (
                  <tr key={r.rowNumber}>
                    <td>Row {r.rowNumber}</td>
                    <td>
                      <Status value={r.errors.length ? 'FAILED' : 'VALIDATING'} />
                    </td>
                    <td>
                      {r.errors.join('; ') ||
                        (formBlocked
                          ? 'Valid row — form access is blocked'
                          : 'Ready for submission')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {formBlocked && (
            <div className="notice error" role="alert">
              <AlertTriangle size={20} />
              <div>
                <strong>Row validation passed, but this form has submission restrictions.</strong>
                {validation.data.formBlockers.map((reason: string, i: number) => (
                  <p key={i}>{restrictionMessage(reason)}</p>
                ))}
                <p>
                  Ask the form owner about respondent access. Valid Excel rows do not remove Google
                  sign-in requirements.
                </p>
                {validation.data.formId && (
                  <Link href={`/forms/${validation.data.formId}`}>
                    Review form access and reanalyze
                  </Link>
                )}
              </div>
            </div>
          )}
          <div className="panel confirm-panel">
            <ShieldCheck size={24} />
            <div>
              <h3>Authorize this submission batch</h3>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={authorized}
                  disabled={formBlocked}
                  onChange={(e) => setAuthorized(e.target.checked)}
                />
                I have permission to submit to this form and have reviewed the{' '}
                {validation.data.valid} valid records. I understand each row creates a separate
                response.
              </label>
              <p className="small-note">
                Unknown results are never retried automatically. Responses already submitted cannot
                be undone by cancelling.
              </p>
            </div>
            <button
              className="btn"
              disabled={formBlocked || !authorized || !validation.data.valid || start.isPending}
              onClick={() => start.mutate()}
            >
              <Play size={17} />
              Submit {validation.data.valid} rows
            </button>
          </div>
          {start.isError && <ErrorBox error={start.error} />}
        </>
      )}
    </>
  );
}
function JobTable({ jobs, reports = false }: { jobs: Job[]; reports?: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Form / batch</th>
            <th>Status</th>
            <th>Records</th>
            <th>Created</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td>
                <Link className="job-title" href={`/jobs/${job.id}`}>
                  <span className="table-icon">
                    <ClipboardList size={18} />
                  </span>
                  <span>
                    <strong>{job.title}</strong>
                    <small>{job.id.slice(0, 8)}</small>
                  </span>
                </Link>
              </td>
              <td>
                <Status value={job.status} />
              </td>
              <td>{job._count?.records ?? '—'}</td>
              <td>{new Date(job.createdAt).toLocaleDateString()}</td>
              <td>
                {reports ? (
                  <DownloadButton
                    path={`/submissions/${job.id}/report`}
                    name={`report-${job.id}.xlsx`}
                  />
                ) : (
                  <Link href={`/jobs/${job.id}`} aria-label={`View ${job.title}`}>
                    <ArrowRight size={18} />
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Jobs({
  history = false,
  reports = false,
}: {
  history?: boolean;
  reports?: boolean;
}) {
  const jobs = useQuery({
    queryKey: ['jobs'],
    queryFn: () => get<Job[]>('/submissions'),
    refetchInterval: 10000,
  });
  const items =
    jobs.data?.filter((j) => !history || ['COMPLETED', 'CANCELLED'].includes(j.status)) ?? [];
  return (
    <>
      <PageTitle
        title={reports ? 'Reports' : history ? 'Submission History' : 'Submission Jobs'}
        description={
          reports
            ? 'Download row-level outcomes without exposing response contents.'
            : 'Follow every batch from queued to verified.'
        }
        action={
          <Link href="/upload" className="btn">
            <Plus size={17} />
            New batch
          </Link>
        }
      />
      <div className="panel">
        {jobs.isPending ? (
          <Loading />
        ) : jobs.isError ? (
          <ErrorBox error={jobs.error} />
        ) : items.length ? (
          <JobTable jobs={items} reports={reports} />
        ) : (
          <Empty title="No submission jobs yet">
            Validated and authorized batches will appear here.
          </Empty>
        )}
      </div>
    </>
  );
}
export function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const [page, setPage] = useState(1);
  const client = useQueryClient();
  const job = useQuery({
    queryKey: ['job', id],
    queryFn: () => get<Job>(`/submissions/${id}`),
    refetchInterval: 4000,
  });
  const records = useQuery({
    queryKey: ['records', id, page],
    queryFn: () => get<any[]>(`/submissions/${id}/records?page=${page}`),
    refetchInterval: 4000,
  });
  const action = useMutation({
    mutationFn: (name: string) => api.post(`/submissions/${id}/${name}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['job', id] });
      void client.invalidateQueries({ queryKey: ['records', id] });
    },
  });
  const toast = useToast();
  const retry = useMutation({
    mutationFn: (recordId: string) => api.post(`/submissions/${id}/retry`, { recordId }),
    onSuccess: () => {
      toast('Row queued for a safe retry.');
      void client.invalidateQueries();
    },
    onError: (e) => toast(errorMessage(e)),
  });
  if (job.isPending) return <Loading />;
  if (job.isError) return <ErrorBox error={job.error} />;
  const counts = job.data.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const pending = (counts.QUEUED ?? 0) + (counts.RUNNING ?? 0);
  const processed = total - pending;
  const attention = counts.NEEDS_MANUAL_ACTION ?? 0;
  const percent = total ? Math.round(((counts.SUBMITTED ?? 0) / total) * 100) : 0;
  return (
    <>
      <PageTitle
        eyebrow={`SUBMISSION JOB · ${id?.slice(0, 8)}`}
        title={job.data.title}
        description="Only visibly confirmed responses are counted as submitted."
        action={<DownloadButton path={`/submissions/${id}/report`} name="submission-report.xlsx" />}
      />
      <div className="panel job-progress">
        <div className="progress-title">
          <Status value={job.data.status} />
          <span>
            <Clock3 size={15} />
            Started {new Date(job.data.createdAt).toLocaleString()}
          </span>
        </div>
        <div className="progress-counts">
          {[
            ['Total records', total],
            ['Submitted', counts.SUBMITTED ?? 0],
            ['Failed', counts.FAILED ?? 0],
            ['Unverified', counts.UNKNOWN ?? 0],
            ['Needs attention', attention],
            ['Pending', pending],
          ].map(([label, value]) => (
            <div key={label}>
              <small>{label}</small>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <div className="progress-caption">
          <span>Verified submission progress</span>
          <strong>{percent}%</strong>
        </div>
        <progress value={percent} max={100} />
        <p className="small-note">
          {counts.SUBMITTED ?? 0} of {total} responses verified. {processed} rows have a processing
          outcome;
          {attention} need manual action. Processing outcomes do not mean responses were saved.
        </p>
        <div className="action-row">
          {['QUEUED', 'RUNNING'].includes(job.data.status) && (
            <button
              className="btn secondary"
              disabled={action.isPending}
              onClick={() => action.mutate('pause')}
            >
              <Pause size={16} />
              Pause
            </button>
          )}
          {job.data.status === 'PAUSED' && (counts.QUEUED ?? 0) > 0 && (
            <button
              className="btn"
              disabled={action.isPending}
              onClick={() => action.mutate('resume')}
            >
              <Play size={16} />
              Resume remaining rows
            </button>
          )}
          {['QUEUED', 'RUNNING', 'PAUSED'].includes(job.data.status) && (
            <button
              className="btn danger"
              disabled={action.isPending}
              onClick={() => action.mutate('cancel')}
            >
              <X size={16} />
              Cancel remaining rows
            </button>
          )}
        </div>
        {job.data.reason && (
          <div className="notice">
            <AlertTriangle size={18} />
            {job.data.reason}
          </div>
        )}
        {action.isError && <ErrorBox error={action.error} />}
      </div>
      {(counts.UNKNOWN ?? 0) > 0 && (
        <div className="notice error">
          <AlertTriangle size={20} />
          <p>
            Some rows have unverified results. Check the original form owner’s responses. These rows
            cannot be automatically retried because they may already have been saved.
          </p>
        </div>
      )}
      <div className="section-heading">
        <div>
          <h2>Record activity</h2>
          <p>Records are identified by Excel row to keep personal details private.</p>
        </div>
        <span className="live-label">
          <span />
          Live updates
        </span>
      </div>
      <div className="panel">
        {records.isPending ? (
          <Loading />
        ) : records.isError ? (
          <ErrorBox error={records.error} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Excel row</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Verified at</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {records.data.map((r) => (
                  <tr key={r.id}>
                    <td>Row {r.rowNumber}</td>
                    <td>
                      <Status value={r.status} />
                    </td>
                    <td>{r.attemptCount}</td>
                    <td>{r.submittedAt ? new Date(r.submittedAt).toLocaleString() : '—'}</td>
                    <td className="error-cell">
                      {r.error ?? '—'}
                      {safeToRetry(
                        r.status,
                        r.submitIntentAt ? new Date(r.submitIntentAt) : null,
                        r.error,
                      ) &&
                        ['COMPLETED', 'PAUSED'].includes(job.data.status) && (
                          <button
                            className="text-button"
                            disabled={retry.isPending}
                            onClick={() => retry.mutate(r.id)}
                          >
                            Retry this unsubmitted row
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination">
          <button className="btn secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>Page {page}</span>
          <button
            className="btn secondary"
            disabled={(records.data?.length ?? 0) < 100}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
}
export function Settings() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get('/settings') });
  const google = useQuery({ queryKey: ['google'], queryFn: () => get('/google/status') });
  const audit = useQuery({ queryKey: ['audit'], queryFn: () => get<any[]>('/audit') });
  const toast = useToast();
  const client = useQueryClient();
  const [confirm, setConfirm] = useState('');
  const connect = useMutation({
    mutationFn: () => get<{ url: string }>('/google/connect'),
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (e) => toast(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete('/data', { data: { confirm } }),
    onSuccess: () => {
      setConfirm('');
      void client.invalidateQueries();
      toast('Stored form and submission data deleted.');
    },
  });
  return (
    <>
      <PageTitle title="Settings" description="Manage your Google connection and workspace data." />
      <div className="settings-grid">
        <section className="panel">
          <h2>Google Forms owner access</h2>
          <p>
            Connect OAuth to analyze forms you own through the official Forms API. This does not
            bypass respondent sign-in requirements.
          </p>
          {google.isError && <ErrorBox error={google.error} />}
          <div className="action-row">
            <button
              className="btn"
              disabled={!google.data?.enabled || connect.isPending}
              onClick={() => connect.mutate()}
            >
              {google.data?.connected ? 'Reconnect Google' : 'Connect Google'}
            </button>
            {google.data?.connected && (
              <button
                className="btn secondary"
                onClick={() =>
                  void api
                    .delete('/google/connection')
                    .then(() => client.invalidateQueries({ queryKey: ['google'] }))
                    .catch((e) => toast(errorMessage(e)))
                }
              >
                Disconnect
              </button>
            )}
          </div>
          {google.data && !google.data.enabled && (
            <p className="small-note">
              Configure Google OAuth environment variables to enable this connection.
            </p>
          )}
        </section>
        <section className="panel">
          <h2>Processing limits</h2>
          {settings.isError ? (
            <ErrorBox error={settings.error} />
          ) : settings.data ? (
            <dl>
              <dt>Workbook rows</dt>
              <dd>{settings.data.maxRows.toLocaleString()}</dd>
              <dt>Upload size</dt>
              <dd>{settings.data.maxUploadMB} MB</dd>
              <dt>Retention policy</dt>
              <dd>{settings.data.retentionDays} days</dd>
            </dl>
          ) : (
            <Loading />
          )}
          <p className="small-note">
            Limits are configured by the server administrator. The retention command must be
            scheduled on the server.
          </p>
        </section>
        <section className="panel">
          <h2>Delete workspace data</h2>
          <p>
            Delete your forms, templates, uploads, and submission history. Cancel all active jobs
            first. Submitted responses remain with the form owner.
          </p>
          <label htmlFor="delete-confirm">Type DELETE MY DATA to confirm</label>
          <input id="delete-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <button
            className="btn danger"
            disabled={confirm !== 'DELETE MY DATA' || remove.isPending}
            onClick={() => remove.mutate()}
          >
            Delete my data
          </button>
          {remove.isError && <ErrorBox error={remove.error} />}
        </section>
        <section className="panel">
          <h2>Recent audit events</h2>
          {audit.isPending ? (
            <Loading />
          ) : audit.isError ? (
            <ErrorBox error={audit.error} />
          ) : (
            <div className="audit-list">
              {audit.data.map((event) => (
                <div key={event.id}>
                  <span>{event.action.replaceAll('_', ' ')}</span>
                  <small>{new Date(event.createdAt).toLocaleString()}</small>
                </div>
              ))}
              {!audit.data.length && <p>No events recorded.</p>}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
