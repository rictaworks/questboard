import GoogleCallback from "@/components/google-callback";

// 同名のクエリパラメータが複数回現れると Next は配列を渡す（?code=a&code=b）。
// 配列をそのまま下流に流すと truthy なので「必須パラメータが無い」判定を素通りし、
// バックエンドのトークン交換に配列が届いて 502 になる。利用者にはログイン
// コールバック画面で生のバックエンドエラーが出る。
// 文字列でないものは受け取らなかったものとして扱い、callbackMissingCode の
// メッセージに寄せる。
function readParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

export default async function GoogleCallbackPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  return <GoogleCallback code={readParam(params.code)} state={readParam(params.state)} />;
}
