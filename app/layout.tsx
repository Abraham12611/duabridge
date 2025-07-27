import type { Metadata } from "next";
import "./globals.css";
import Image from "next/image";
import logo from "@/app/assets/getautocue_logo_mid.png";

export const metadata: Metadata = {
  title: "LinguaBridge",
  description:
    "Real-time cross-language voice translation with ultra-low latency",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className="fixed top-0 left-0 z-50 p-4">
          <div className="font-bold text-xl text-blue-600">LinguaBridge</div>
        </div>
        {children}
      </body>
    </html>
  );
}
