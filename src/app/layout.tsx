import type { Metadata } from "next";
import { Cantarell } from "next/font/google";
import "./globals.css";

const cantarell = Cantarell ({
  variable: "--font-cantarell",
  weight: ["400", "700"],
  subsets: ["latin"],
});


export const metadata: Metadata = {
  title: "My Music",
  description: "Listen to and download my music.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
      <html lang="en" className={cantarell.variable}>
      <body className="antialiased p-8">
        {children}
      </body>
    </html>
  );
}
