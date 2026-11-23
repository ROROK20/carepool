"use client";

import { buttonClass } from "./ui";

/** Opens the browser's print dialog. Hidden on paper. */
export function PrintButton({ children }: { children: React.ReactNode }) {
  return (
    <button type="button" onClick={() => window.print()} className={`${buttonClass.primary} print:hidden`} data-testid="print-button">
      {children}
    </button>
  );
}
