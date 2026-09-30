import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { PipelineProvider } from "@/context/pipeline-context";

// App shell for every signed-in page. /login lives outside this route group
// so it renders without the sidebar/top bar (and without their API fetches).
export default function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <PipelineProvider>
      <SidebarProvider>
        <AppSidebar />
        <main className="flex-1 overflow-auto min-h-screen">
          <TopBar />
          <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
        </main>
      </SidebarProvider>
    </PipelineProvider>
  );
}
