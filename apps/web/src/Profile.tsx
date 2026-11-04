'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, Mail, ShieldCheck, UserRound, Pencil, Clock3 } from 'lucide-react';
import { genderOptions, signupProfileSchema } from '../../../packages/shared/src/account';
import { api, get, errorMessage } from './api';

type Verification = {
  email: string;
  verificationId: string;
  expiresAt: string;
  resendAfterSeconds: number;
};
type Profile = {
  id: string;
  email: string;
  name: string | null;
  phoneNumber: string | null;
  address: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  emailVerifiedAt: string | null;
  pendingEmailChange?: Verification | null;
};
type Values = z.infer<typeof signupProfileSchema>;
function ErrorNotice({ error }: { error: unknown }) {
  return (
    <p className="notice error" role="alert">
      {errorMessage(error)}
    </p>
  );
}

export function ProfilePage() {
  const [editing, setEditing] = useState(false);
  const profile = useQuery({
    queryKey: ['profile'],
    queryFn: () => get<Profile>('/profile'),
    refetchOnWindowFocus: false,
  });
  if (profile.isPending)
    return (
      <p className="panel" role="status">
        Loading your profile…
      </p>
    );
  if (profile.isError) return <ErrorNotice error={profile.error} />;
  return editing ? (
    <ProfileEditor profile={profile.data} onView={() => setEditing(false)} />
  ) : (
    <ProfileOverview profile={profile.data} onEdit={() => setEditing(true)} />
  );
}

function ProfileOverview({ profile, onEdit }: { profile: Profile; onEdit: () => void }) {
  const activity = useQuery({
    queryKey: ['audit'],
    queryFn: () => get<{ id: string; action: string; createdAt: string }[]>('/audit'),
  });
  const initials = (profile.name || profile.email)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">YOUR ACCOUNT</div>
          <h1>My profile</h1>
          <p>Your personal information and account activity.</p>
        </div>
        <button className="btn" onClick={onEdit}>
          <Pencil size={16} />
          Edit profile
        </button>
      </div>
      <div className="profile-overview-grid">
        <section className="panel profile-summary" aria-labelledby="profile-summary-title">
          <div className="profile-avatar" aria-hidden="true">
            {initials}
          </div>
          <h2 id="profile-summary-title">{profile.name || 'Your profile'}</h2>
          <p>Personal workspace</p>
          <button className="profile-edit-link" onClick={onEdit}>
            <Pencil size={14} />
            Edit personal details
          </button>
          <div className="profile-summary-section">
            <h3>Contact information</h3>
            <dl>
              <div>
                <dt>Email address</dt>
                <dd>{profile.email}</dd>
              </div>
              <div>
                <dt>Phone number</dt>
                <dd>{profile.phoneNumber || 'Not provided'}</dd>
              </div>
              <div>
                <dt>Address</dt>
                <dd>{profile.address || 'Not provided'}</dd>
              </div>
            </dl>
          </div>
          <div className="profile-summary-section">
            <h3>Personal information</h3>
            <dl>
              <div>
                <dt>Date of birth</dt>
                <dd>{profile.dateOfBirth || 'Not provided'}</dd>
              </div>
              <div>
                <dt>Gender</dt>
                <dd>{profile.gender || 'Not provided'}</dd>
              </div>
            </dl>
          </div>
        </section>
        <section className="panel profile-activity" aria-labelledby="profile-activity-title">
          <h2 id="profile-activity-title">Recent activity</h2>
          <p className="profile-section-description">The latest updates in your workspace.</p>
          {activity.isPending ? (
            <p role="status">Loading activity…</p>
          ) : activity.isError ? (
            <ErrorNotice error={activity.error} />
          ) : activity.data?.length ? (
            <ol className="profile-timeline">
              {activity.data.slice(0, 10).map((event) => (
                <li key={event.id}>
                  <strong>
                    {event.action
                      .toLowerCase()
                      .replaceAll('_', ' ')
                      .replace(/^./, (char) => char.toUpperCase())}
                  </strong>
                  <span>
                    <Clock3 size={13} />
                    {new Date(event.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="profile-activity-empty">
              <Clock3 size={28} />
              <p>Your recent account and workflow activity will appear here.</p>
            </div>
          )}
        </section>
        <div className="profile-security-stack">
          <section className="panel">
            <div className="profile-section-heading">
              <span className="profile-section-icon">
                <ShieldCheck size={23} />
              </span>
              <div>
                <h2>Account security</h2>
                <p>Email verification</p>
              </div>
            </div>
            <div className="current-email">
              <span>Sign-in email</span>
              <strong>{profile.email}</strong>
              <small>
                <ShieldCheck size={14} />
                {profile.emailVerifiedAt ? 'Verified email' : 'Email not yet verified'}
              </small>
            </div>
            <p className="profile-security-note">
              Changing your email requires a verification code sent to the new address.
            </p>
            {profile.pendingEmailChange && (
              <p className="auth-hint">
                Verification pending for {profile.pendingEmailChange.email}.
              </p>
            )}
            <button className="btn secondary" onClick={onEdit}>
              Edit account email
            </button>
          </section>
          <section className="panel">
            <h2>Your information</h2>
            <p className="profile-security-note">
              Keep your contact details current. Use Edit profile to review and update the
              information you shared at signup.
            </p>
            <span className="profile-privacy-note">
              <ShieldCheck size={16} />
              Private to your account
            </span>
          </section>
        </div>
      </div>
    </>
  );
}

function ProfileEditor({ profile, onView }: { profile: Profile; onView: () => void }) {
  const client = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(signupProfileSchema),
    defaultValues: {
      name: profile.name ?? '',
      phoneNumber: profile.phoneNumber ?? '',
      address: profile.address ?? '',
      dateOfBirth: profile.dateOfBirth ?? '',
      gender: (profile.gender as Values['gender']) || undefined,
    },
  });
  const [saved, setSaved] = useState(false);
  const update = useMutation({
    mutationFn: (values: Values) => api.patch('/profile', values),
    onSuccess: (response) => {
      const next = response.data.data as Profile;
      form.reset({
        name: next.name ?? '',
        phoneNumber: next.phoneNumber ?? '',
        address: next.address ?? '',
        dateOfBirth: next.dateOfBirth ?? '',
        gender: next.gender as Values['gender'],
      });
      const { name, phoneNumber, address, dateOfBirth, gender } = next;
      client.setQueryData(['profile'], (old: Profile) => ({
        ...old,
        name,
        phoneNumber,
        address,
        dateOfBirth,
        gender,
      }));
      setSaved(true);
    },
  });
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">YOUR ACCOUNT</div>
          <h1>Edit profile</h1>
          <p>Keep your personal details and account email up to date.</p>
        </div>
        <button className="btn secondary" onClick={onView}>
          Back to profile
        </button>
      </div>
      <div className="profile-settings-grid">
        <section className="panel profile-details-panel" aria-labelledby="personal-details-title">
          <div className="profile-section-heading">
            <span className="profile-section-icon">
              <UserRound size={23} />
            </span>
            <div>
              <h2 id="personal-details-title">Personal details</h2>
              <p>Your information, all in one place.</p>
            </div>
          </div>
          <form
            onSubmit={form.handleSubmit((values) => {
              setSaved(false);
              update.mutate(values);
            })}
            onChange={() => setSaved(false)}
          >
            <div className="profile-fields-grid">
              {[
                ['name', 'Full name', 'text', 'name'],
                ['phoneNumber', 'Phone number', 'tel', 'tel'],
                ['dateOfBirth', 'Date of birth', 'date', 'bday'],
              ].map(([key, label, type, autoComplete]) => (
                <div key={key}>
                  <label htmlFor={`profile-${key}`}>{label}</label>
                  <input
                    id={`profile-${key}`}
                    type={type}
                    autoComplete={autoComplete}
                    max={type === 'date' ? new Date().toISOString().slice(0, 10) : undefined}
                    {...form.register(key as keyof Values)}
                    aria-invalid={Boolean(form.formState.errors[key as keyof Values])}
                  />
                  {form.formState.errors[key as keyof Values] && (
                    <p className="field-error" role="alert">
                      {form.formState.errors[key as keyof Values]?.message}
                    </p>
                  )}
                </div>
              ))}
              <div>
                <label htmlFor="profile-gender">Gender</label>
                <select id="profile-gender" {...form.register('gender')}>
                  <option value="">Select gender</option>
                  {genderOptions.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                {form.formState.errors.gender && (
                  <p className="field-error" role="alert">
                    {form.formState.errors.gender.message}
                  </p>
                )}
              </div>
            </div>
            <label htmlFor="profile-address">Address</label>
            <textarea
              id="profile-address"
              rows={3}
              maxLength={500}
              autoComplete="street-address"
              {...form.register('address')}
            />
            {form.formState.errors.address && (
              <p className="field-error" role="alert">
                {form.formState.errors.address.message}
              </p>
            )}
            {update.isError && <ErrorNotice error={update.error} />}
            {saved && (
              <p className="password-feedback matched" role="status">
                <CheckCircle2 size={16} />
                Profile updated successfully.
              </p>
            )}
            <div className="profile-save-actions">
              <button className="btn" disabled={update.isPending}>
                {update.isPending ? 'Saving…' : 'Save profile'}
              </button>
            </div>
          </form>
        </section>
        <EmailEditor profile={profile} />
      </div>
    </>
  );
}

function EmailEditor({ profile }: { profile: Profile }) {
  const client = useQueryClient();
  const [pending, setPending] = useState<Verification | null>(profile.pendingEmailChange ?? null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [now, setNow] = useState(Date.now());
  const [resendAt, setResendAt] = useState(Date.now() + (pending?.resendAfterSeconds ?? 0) * 1000);
  const [verified, setVerified] = useState(false);
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending]);
  function accept(next: Verification) {
    setPending(next);
    setCode('');
    setNow(Date.now());
    setResendAt(Date.now() + next.resendAfterSeconds * 1000);
    setVerified(false);
    client.setQueryData(['profile'], (old: Profile) => ({ ...old, pendingEmailChange: next }));
  }
  const request = useMutation({
    mutationFn: () => api.post('/profile/email-change', { email }),
    onSuccess: (response) => {
      accept(response.data.data);
      verify.reset();
    },
  });
  const resend = useMutation({
    mutationFn: () =>
      api.post('/profile/email-change/resend', { verificationId: pending?.verificationId }),
    onSuccess: (response) => {
      accept(response.data.data);
      verify.reset();
    },
  });
  const verify = useMutation({
    mutationFn: () =>
      api.post('/profile/email-change/verify', { verificationId: pending?.verificationId, code }),
    onSuccess: async (response) => {
      const next = response.data.data as Profile;
      await client.cancelQueries({ queryKey: ['me'] });
      client.setQueryData(['profile'], (old: Profile) => ({
        ...old,
        email: next.email,
        emailVerifiedAt: next.emailVerifiedAt,
        pendingEmailChange: null,
      }));
      client.setQueryData(['me'], { id: next.id, email: next.email });
      setPending(null);
      setCode('');
      setEmail('');
      setVerified(true);
      request.reset();
      resend.reset();
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.delete('/profile/email-change'),
    onSuccess: () => {
      setPending(null);
      setCode('');
      request.reset();
      resend.reset();
      verify.reset();
      client.setQueryData(['profile'], (old: Profile) => ({ ...old, pendingEmailChange: null }));
    },
  });
  const busy = request.isPending || resend.isPending || verify.isPending || cancel.isPending;
  const expired = Boolean(pending && new Date(pending.expiresAt).getTime() <= now);
  return (
    <section className="panel profile-email-panel" aria-labelledby="account-email-title">
      <div className="profile-section-heading">
        <span className="profile-section-icon">
          <Mail size={23} />
        </span>
        <div>
          <h2 id="account-email-title">Account email</h2>
          <p>A verified address keeps your account connected.</p>
        </div>
      </div>
      <div className="current-email">
        <span>Current email</span>
        <strong>{profile.email}</strong>
        {profile.emailVerifiedAt && (
          <small>
            <ShieldCheck size={14} />
            Verified
          </small>
        )}
      </div>
      {verified && (
        <p className="password-feedback matched" role="status">
          <CheckCircle2 size={16} />
          Email updated and verified successfully.
        </p>
      )}
      {!pending ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setVerified(false);
            request.mutate();
          }}
        >
          <label htmlFor="new-profile-email">New email address</label>
          <input
            id="new-profile-email"
            type="email"
            autoComplete="email"
            required
            maxLength={191}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <p className="auth-hint">
            We will send a 6-digit OTP to your new email. Your current email stays active until
            verification succeeds.
          </p>
          {request.isError && <ErrorNotice error={request.error} />}
          <button
            className="btn"
            disabled={busy || email.trim().toLowerCase() === profile.email || !email.trim()}
          >
            {request.isPending ? 'Sending code…' : 'Send email verification code'}
          </button>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            verify.mutate();
          }}
        >
          <p className="email-otp-recipient">
            Verification code sent to <strong>{pending.email}</strong>
          </p>
          <label htmlFor="profile-email-code">Email OTP</label>
          <input
            id="profile-email-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
          />
          <p className="auth-hint">The code is valid for 10 minutes. Check your spam folder too.</p>
          {expired && (
            <p className="field-error" role="alert">
              This code has expired. Request a new code.
            </p>
          )}
          {verify.isError && <ErrorNotice error={verify.error} />}
          {resend.isError && <ErrorNotice error={resend.error} />}
          {cancel.isError && <ErrorNotice error={cancel.error} />}
          <div className="profile-email-actions">
            <button className="btn" disabled={busy || expired || !/^\d{6}$/.test(code)}>
              {verify.isPending ? 'Verifying…' : 'Verify & update email'}
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={busy || now < resendAt}
              onClick={() => resend.mutate()}
            >
              {now < resendAt
                ? `Resend code (${Math.ceil((resendAt - now) / 1000)}s)`
                : 'Resend code'}
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={() => cancel.mutate()}
            >
              Cancel email change
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
