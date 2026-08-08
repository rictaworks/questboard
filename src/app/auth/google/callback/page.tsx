import GoogleCallback from "@/components/google-callback";

export default async function GoogleCallbackPage({
  searchParams
}: {
  searchParams: Promise<{code?: string; state?: string}>;
}) {
  const params = await searchParams;
  return <GoogleCallback code={params.code ?? null} state={params.state ?? null} />;
}
