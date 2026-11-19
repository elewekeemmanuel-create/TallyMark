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
    <div className="min-h-screen bg-[#FAF8F3] dark:bg-[#0D110F] text-[#121513] dark:text-[#F4F1EA] py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <TallymarkWordmark size="md" />
        <div className="mt-6 rounded-2xl border border-[#E5DEC9] dark:border-[#26302B] bg-white dark:bg-[#151B18] p-6 sm:p-8 shadow-sm">
          <p className="label-caps text-[#064E3B] dark:text-[#10B981]">Step 1 of 1 · One-time setup</p>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl text-[#121513] dark:text-[#F4F1EA]">
            Set up your business receipt header
          </h1>
          <p className="mt-1.5 text-sm text-[#5C635D] dark:text-[#9BA39D]">
            Signed in as{' '}
            <strong className="text-[#121513] dark:text-[#F4F1EA]">{user.name || user.email}</strong>
            {user.name && user.name !== user.email && (
              <span className="ml-1">({user.email})</span>
            )}
            . You can edit any of these details later in Settings.
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
