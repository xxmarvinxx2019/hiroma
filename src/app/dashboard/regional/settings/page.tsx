import PasskeySettings from '@/app/components/security/PasskeySettings'
import DistributorSecurityPinSettings from '@/app/components/security/DistributorSecurityPinSettings'

export default function DistributorSettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[#0D1B3E]">Settings</h1>
        <p className="mt-0.5 text-sm text-gray-400">Manage your account security and sign-in devices</p>
      </div>
      <DistributorSecurityPinSettings />
      <PasskeySettings />
    </div>
  )
}