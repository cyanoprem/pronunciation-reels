"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { UserProvider } from "./user-context";
import { DebugOverlay } from "./debug-overlay";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <UserProvider>
        <TooltipProvider>
          {children}
          <Toaster />
          <DebugOverlay />
        </TooltipProvider>
      </UserProvider>
    </QueryClientProvider>
  );
}
