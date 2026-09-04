import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "NeonJam — collaborative jukebox",
  description:
    "A party jukebox for YouTube Music. Host plays, everyone queues from their phone. Nothing stored, nothing downloaded.",
};

export const viewport: Viewport = {
  themeColor: "#07070c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        {children}
        <Toaster
          theme="dark"
          position="top-center"
          toastOptions={{
            style: {
              background: "var(--color-panel)",
              border: "1px solid var(--color-line)",
              color: "var(--color-text)",
            },
          }}
        />
      </body>
    </html>
  );
}
