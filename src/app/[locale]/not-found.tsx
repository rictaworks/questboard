import NotFoundContent from '@/components/not-found-content';

// [locale] セグメント内で notFound() が呼ばれたときの 404。
// 不正なロケール（src/app/[locale]/layout.tsx）やボード未検出がここに来る。
export default function LocaleNotFound() {
  return <NotFoundContent />;
}
