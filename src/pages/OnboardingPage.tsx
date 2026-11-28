import React from 'react';
import { api } from '../lib/api';
import { useRouter } from '../lib/router';
import type { BusinessProfile, UserProfile } from '../shared/types';
import { BusinessProfileForm } from '../components/BusinessProfileForm';
import { TallymarkWordmark } from '../components/TallymarkLogo';

export function OnboardingPage({
  user,
  onCompleted,
}: {
  user: UserProfile;
  onCompleted: (business: BusinessProfile) => void;
}) {
  const { navigate } = useRouter();

  const handleSave = async (payload: Record<string, unknown>) => {
    const res = await api.saveBusiness(payload);
    onCompleted(res.business);
    navigate('/app', { replace: true });
  };

  return (
    <div className="min-h-screen bg-[#F6F7F8] dark:bg-[#0B0F0E] text-[#111827] dark:text-[#F3F4F6] py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <TallymarkWordmark size="md" />
        <div className="mt-6 rounded-[24px] bg-white dark:bg-[#131917] p-6 sm:p-8 shadow-[0_16px_48px_-24px_rgba(17,24,39,0.12)]">
          <span className="inline-flex items-center rounded-full bg-[#ECFDF5] dark:bg-[#064E3B]/40 px-3 py-1 text-xs font-medium text-[#064E3B] dark:text-[#6EE7B7]">
            Step 1 of 1 · One-time setup
          </span>
          <h1 className="mt-3 text-2xl sm:text-3xl font-semibold tracking-[-0.025em] text-[#111827] dark:text-[#F3F4F6]">
            Set up your business profile
          </h1>
          <p className="mt-1.5 text-sm text-[#6B7280] dark:text-[#9CA3AF]">
            Signed in as{' '}
            <strong className="text-[#111827] dark:text-[#F3F4F6]">{user.name || user.email}</strong>
            {user.name && user.name !== user.email && (
              <span className="ml-1">({user.email})</span>
            )}
            . You can edit these details anytime in Settings.
          </p>

          <div className="mt-6">
            <BusinessProfileForm
              defaultEmail={user.email}
              submitLabel="Finish Setup & Open Tallymark"
              onSubmit={handleSave}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
