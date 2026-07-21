import "./globals.css";

export const metadata = {
  title: "10 words a day",
  description: "Daily English vocab practice for SPM students",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
