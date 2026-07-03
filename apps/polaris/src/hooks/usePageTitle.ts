import { useEffect } from "react";

/** Sets the browser tab title for the current page. */
export function usePageTitle(title: string | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · Polaris` : "Polaris";
    return () => {
      document.title = "Polaris";
    };
  }, [title]);
}
