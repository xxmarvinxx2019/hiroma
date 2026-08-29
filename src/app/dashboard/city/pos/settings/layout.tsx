import PosTerminalManagement from "@/app/components/pos/PosTerminalManagement";

export default function PosSettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <div className="mx-auto max-w-5xl px-6 pb-6">
        <PosTerminalManagement />
      </div>
    </>
  );
}
