import NotFoundContent from '@/components/not-found-content';

// ルート直下の 404。src/app/layout.tsx の中に描画されるため、
// lang / dir / title / globals.css がそのまま適用される。
// どのルートにも一致しない URL（/wp-login.php、/ja/unknown 等）はここに来る。
export default function NotFound() {
  return <NotFoundContent />;
}
