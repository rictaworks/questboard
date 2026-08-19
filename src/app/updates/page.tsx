import {getTranslations} from 'next-intl/server';

// 利用者向けの更新履歴ページ（issue #210）。認証不要・日本語のみの静的コンテンツ。
//
// 追記手順（次リリース時）:
// 1. ja.json の Updates セクションへ新バージョンのキー（例: v110Version / v110Date /
//    v110Heading / v110Item1..N）を追加する
// 2. 下の RELEASES 配列の先頭（新しい順）にエントリを追加する
// 3. 文言は利用者向けの平易な表現にする（PR番号・コミットハッシュ等の開発用語は書かない）
// GitHub Release は開発者向け、本ページが利用者向けの情報源という分担にする。
const RELEASES = [
  {
    id: 'v1-0-0',
    versionKey: 'v100Version',
    dateKey: 'v100Date',
    headingKey: 'v100Heading',
    itemKeys: ['v100Item1', 'v100Item2', 'v100Item3', 'v100Item4', 'v100Item5', 'v100Item6', 'v100Item7'],
  },
] as const;

export default async function UpdatesPage() {
  const t = await getTranslations('Updates');

  return (
    <main className="home-shell legal-page">
      <article className="hero-card legal-card">
        <h1 className="home-title">{t('title')}</h1>
        <p className="hero-copy">{t('intro')}</p>

        {RELEASES.map((release) => (
          <section className="legal-section" id={release.id} key={release.id}>
            <h2>
              {t('versionLine', {
                version: t(release.versionKey),
                date: t(release.dateKey),
                heading: t(release.headingKey),
              })}
            </h2>
            <ul className="updates-list">
              {release.itemKeys.map((itemKey) => (
                <li key={itemKey}>{t(itemKey)}</li>
              ))}
            </ul>
          </section>
        ))}
      </article>
    </main>
  );
}
