import "./globals.css";

export const metadata = {
  title: "CovenantOne",
  description: "An intentional relationship platform for adults seriously considering marriage.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
